import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateDiscountAmount, calculateStorefrontTotals, couponLookupSchema,
  discountAvailabilityError, discountSchema, publicDiscount,
} from "../lib/discounts";
import { moduleLoader } from "./helpers/load-module";
import { discountApiError } from "../lib/discount-feedback";

const valid = { code: " save10 ", type: "PERCENT", value: "10", expiresAt: null };
const now = new Date("2026-10-04T12:00:00Z");

test("creation and editing share normalized, bounded discount input", () => {
  assert.deepEqual(discountSchema.parse(valid), {
    code: "SAVE10", type: "PERCENT", value: 10, isActive: true, expiresAt: null,
  });
  for (const value of ["", " ", null, false, "10junk", NaN, Infinity, 0, -1, 100.01, "0.001"]) {
    assert.equal(discountSchema.safeParse({ ...valid, value }).success, false, String(value));
  }
  for (const code of ["", " ", "A", "SAVE 10", "X".repeat(51)]) {
    assert.equal(discountSchema.safeParse({ ...valid, code }).success, false, code);
  }
  assert.equal(discountSchema.safeParse({ ...valid, value: 100 }).success, true);
  assert.equal(discountSchema.safeParse({ ...valid, type: "FIXED", value: 1_000_000 }).success, true);
  assert.equal(discountSchema.safeParse({ ...valid, type: "FIXED", value: 1_000_000.01 }).success, false);
});

test("date-only expiry means end of UTC day, exact ISO instants stay unchanged", () => {
  assert.equal(discountSchema.parse({ ...valid, expiresAt: "2026-10-04" }).expiresAt?.toISOString(), "2026-10-04T23:59:59.999Z");
  assert.equal(discountSchema.parse({ ...valid, expiresAt: "2026-10-04T10:00:00+02:00" }).expiresAt?.toISOString(), "2026-10-04T08:00:00.000Z");
  for (const expiresAt of ["2026-02-30", "0026-10-04", "bad", "2026-10-04T12:00:00"]) {
    assert.equal(discountSchema.safeParse({ ...valid, expiresAt }).success, false, expiresAt);
  }
  const discount = { type: "FIXED" as const, value: 10, expiresAt: now };
  assert.equal(discountAvailabilityError(discount, new Date(now.getTime() - 1)), null);
  assert.match(discountAvailabilityError(discount, now)!, /expired/);
  assert.match(discountAvailabilityError({ ...discount, expiresAt: "bad" }, now)!, /invalid/);
});

test("availability rejects legacy invalid values, inactive/expired codes and Lite constraints", () => {
  const discount = { type: "PERCENT" as const, value: 10, isActive: true };
  for (const value of [NaN, Infinity, -1, 0, 150]) {
    assert.match(discountAvailabilityError({ ...discount, value }, now)!, /invalid/);
  }
  assert.match(discountAvailabilityError({ ...discount, isActive: false }, now)!, /inactive/);
  assert.match(discountAvailabilityError({ ...discount, minAmount: "100.00" }, now, 99.99)!, /minimum/);
  assert.equal(discountAvailabilityError({ ...discount, minAmount: "100.00" }, now, 100), null);
  assert.match(discountAvailabilityError({ ...discount, usageLimit: 2, used: 2 }, now)!, /limit/);
  assert.equal(discountAvailabilityError({ ...discount, usageLimit: 2, used: 1 }, now), null);
  assert.match(discountAvailabilityError({ ...discount, maxDiscount: "-1" }, now)!, /invalid/);
});

test("discount is capped at the subtotal, rounded exactly, and supports zero-decimal currencies", () => {
  assert.equal(calculateDiscountAmount(50, { type: "FIXED", value: 200 }), 50);
  assert.equal(calculateDiscountAmount(0, { type: "FIXED", value: 10 }), 0);
  assert.equal(calculateDiscountAmount("0.10", { type: "PERCENT", value: 5 }), 0.01);
  assert.equal(calculateDiscountAmount(19.99, { type: "PERCENT", value: 15 }), 3);
  assert.equal(calculateDiscountAmount(999, { type: "PERCENT", value: 15 }, "JPY"), 150);
  assert.equal(calculateDiscountAmount(100, { type: "PERCENT", value: 50, maxDiscount: "12.50" }), 12.5);
  assert.throws(() => calculateDiscountAmount(100, { type: "PERCENT", value: 150 }), /invalid/);
  assert.equal(couponLookupSchema.safeParse({ code: "CODE", orderAmount: 0 }).success, true);
  for (const orderAmount of ["100", null, -1, Infinity]) {
    assert.equal(couponLookupSchema.safeParse({ code: "CODE", orderAmount }).success, false);
  }
});

test("storefront totals discount products before tax, never tax/shipping, and expose stale codes", () => {
  const settings = { currency: "USD", taxRate: 20, shippingCost: 5, freeShippingThreshold: 500 };
  const totals = calculateStorefrontTotals([{ price: 100, quantity: 1 }], { type: "FIXED", value: 10 }, settings);
  assert.deepEqual(totals, { subtotal: 100, discountAmount: 10, discountError: null, tax: 18, shipping: 5, total: 113 });
  const free = calculateStorefrontTotals([{ price: 100, quantity: 1 }], { type: "PERCENT", value: 100 }, settings);
  assert.equal(free.total, 5);
  assert.equal(free.tax, 0);
  const stale = calculateStorefrontTotals([{ price: 100, quantity: 1 }], { type: "PERCENT", value: 150 }, settings);
  assert.equal(stale.discountAmount, 0);
  assert.match(stale.discountError!, /invalid/);
  const threshold = { ...settings, freeShippingThreshold: 100 };
  assert.equal(calculateStorefrontTotals([{ price: 100, quantity: 1 }], { type: "FIXED", value: 10 }, threshold, "discounted").shipping, 5);
  assert.equal(calculateStorefrontTotals([{ price: 100, quantity: 1 }], { type: "FIXED", value: 10 }, threshold, "subtotal").shipping, 0);
});

test("public discount includes constraints, but never usage counters", () => {
  const result = publicDiscount({ code: "TEST", type: "FIXED", value: 10, minAmount: "100.00", maxDiscount: "5.00", usageLimit: 1, used: 0 });
  assert.equal(result.minAmount, 100);
  assert.equal(result.maxDiscount, 5);
  assert.equal("used" in result, false);
  assert.equal("usageLimit" in result, false);
});

test("unexpected database errors are not leaked to customers", () => {
  const original = console.error;
  console.error = () => {};
  try {
    const response = discountApiError(new Error("private database credentials"));
    assert.equal(response.status, 500);
    assert.doesNotMatch(JSON.stringify(response.body), /private|credentials/);
  } finally {
    console.error = original;
  }
});

test("actual create/update/delete routes enforce auth and return useful validation/DB errors", async () => {
  let role = "CUSTOMER";
  let writes = 0;
  let written: any;
  let failure: unknown;
  const write = async ({ data }: any) => {
    writes++;
    if (failure) throw failure;
    written = data;
    return { id: "discount-1", ...data };
  };
  const load = moduleLoader({
    "@/lib/auth": { auth: async () => ({ user: { role } }) },
    "@/lib/db": { db: { discountCode: { create: write, update: write, delete: write } } },
  });
  const { POST } = load("app/api/discounts/route.ts");
  const { PUT, DELETE } = load("app/api/discounts/[id]/route.ts");
  const request = (body: unknown) => new Request("http://localhost/api/discounts", { method: "POST", body: JSON.stringify(body) });
  const handlers = [POST, (req: Request) => PUT(req, { params: { id: "discount-1" } })];
  for (const handler of handlers) assert.equal((await handler(request(valid))).status, 401);
  assert.equal(writes, 0);
  role = "ADMIN";
  for (const handler of handlers) {
    const bad = await handler(request({ ...valid, value: 150 }));
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).fieldErrors.value, /100/);
  }
  assert.equal(writes, 0);
  for (const [index, handler] of handlers.entries()) {
    const response = await handler(request({ ...valid, expiresAt: "2026-10-04" }));
    assert.equal(response.status, index === 0 ? 201 : 200);
    assert.equal(written.code, "SAVE10");
    assert.equal(written.expiresAt.toISOString(), "2026-10-04T23:59:59.999Z");
    failure = { code: "P2002", message: "private database details" };
    const duplicate = await handler(request(valid));
    assert.equal(duplicate.status, 409);
    assert.ok((await duplicate.json()).fieldErrors.code);
    failure = { code: "P2025" };
    assert.equal((await handler(request(valid))).status, 404);
    failure = undefined;
    assert.equal((await handler(new Request("http://localhost", { method: "POST", body: "{" }))).status, 400);
  }
  failure = { code: "P2025" };
  assert.equal((await DELETE(request(valid), { params: { id: "missing" } })).status, 404);
});

test("actual public routes normalize input and agree on expiry, validity, limits and clamping", async () => {
  let discount: any = { id: "d", code: "SAVE10", type: "FIXED", value: 200, isActive: true, expiresAt: null };
  let lookedUp = "";
  let rateResult: any = { success: true };
  const load = moduleLoader({
    "@/lib/auth": { auth: async () => null },
    "@/lib/db": { db: {
      discountCode: { findUnique: async ({ where }: any) => { lookedUp = where.code; return discount; } },
      storeSettings: { findFirst: async () => ({ currency: "USD" }) },
    } },
    "@/lib/rate-limit": { checkRateLimit: async () => rateResult },
    "@/lib/request-identity": { getTrustedClientIdentifier: () => "mock" },
  });
  const validate = load("app/api/discounts/validate/route.ts").POST;
  const coupon = load("app/api/coupons/validate/route.ts").POST;
  const request = (body: unknown) => new Request("http://localhost", { method: "POST", body: JSON.stringify(body) });
  const input = { code: " save10 ", orderAmount: 50 };
  const response = await coupon(request(input));
  assert.equal(response.status, 200);
  assert.equal(lookedUp, "SAVE10");
  const body = await response.json();
  assert.equal(body.discount, 50);
  assert.equal(body.finalAmount, 0);
  assert.equal((await validate(request(input))).status, 200);
  for (const override of [
    { value: -10 }, { type: "PERCENT", value: 150 }, { isActive: false },
    { expiresAt: new Date(0) }, { expiresAt: "bad" }, { minAmount: 100 }, { usageLimit: 1, used: 1 },
  ]) {
    discount = { code: "SAVE10", type: "FIXED", value: 10, isActive: true, expiresAt: null, ...override };
    for (const handler of [validate, coupon]) assert.equal((await handler(request(input))).status, 400, JSON.stringify(override));
  }
  for (const handler of [validate, coupon]) {
    assert.equal((await handler(request({ code: 123, orderAmount: 50 }))).status, 400);
    assert.equal((await handler(new Request("http://localhost", { method: "POST", body: "{" }))).status, 400);
    discount = null;
    assert.equal((await handler(request(input))).status, 404);
    rateResult = { success: false, unavailable: false };
    assert.equal((await handler(request(input))).status, 429);
    rateResult = { success: false, unavailable: true };
    assert.equal((await handler(request(input))).status, 503);
    rateResult = { success: true };
  }
});
