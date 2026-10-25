import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { moduleLoader } from "./helpers/load-module";
import { createFakeOrdersDb, cuid } from "./helpers/fake-orders-db";

process.env.STRIPE_DEPLOYMENT_ID = "store-test";
process.env.NEXT_PUBLIC_APP_URL = "https://shop.example.com";
process.env.GUEST_ORDER_TOKEN_SECRET = "test-guest-secret-test-guest-secret-0123456789";

const silentLogger = { info() {}, warn() {}, error() {} };
const PRODUCT_ID = cuid("product-a");
const USER_ID = cuid("user-a");
const OTHER_USER_ID = cuid("user-b");

const address = {
  firstName: "Ada", lastName: "Lovelace", email: "Ada@Example.com", phone: "+49 30 123456",
  street: "Main street 1", city: "Berlin", state: "", postalCode: "10115", country: "DE",
};

type Options = {
  settings?: Record<string, unknown> | null;
  products?: Array<Record<string, unknown>>;
  orders?: Array<Record<string, unknown>>;
  items?: Array<Record<string, unknown>>;
  addresses?: Array<Record<string, unknown>>;
  sessionUser?: string | null;
  sessionRetrieve?: (id: string) => any;
  sessionCreate?: (params: any) => any;
  rateLimit?: (identifier: string, type: string) => any;
  discountCodes?: Array<Record<string, unknown>>;
};

function setup(options: Options = {}) {
  const { db, state } = createFakeOrdersDb({
    settings: options.settings === undefined
      ? { currency: "USD", taxRate: 0, shippingCost: 0, freeShippingThreshold: 500, enabledCountries: [] }
      : options.settings,
    products: options.products ?? [{ id: PRODUCT_ID, name: "Mug", price: new Prisma.Decimal("20.00"), stock: 10, isArchived: false, image: "https://example.com/mug.png" }],
    users: [{ id: USER_ID, email: "user@example.com" }, { id: OTHER_USER_ID, email: "other@example.com" }],
    orders: options.orders,
    items: options.items,
    addresses: options.addresses,
    discountCodes: options.discountCodes,
  });
  const calls = {
    sessionsCreated: [] as any[],
    rateLimits: [] as Array<[string, string]>,
    expired: [] as string[],
  };
  const stripe = {
    checkout: {
      sessions: {
        create: async (params: any) => {
          calls.sessionsCreated.push(params);
          if (options.sessionCreate) return options.sessionCreate(params);
          return { id: `cs_${calls.sessionsCreated.length}`, url: "https://checkout.stripe.test/pay", payment_intent: null };
        },
        retrieve: async (id: string) => options.sessionRetrieve?.(id) ?? { id, status: "open", payment_status: "unpaid", url: "https://checkout.stripe.test/pay" },
        expire: async (id: string) => { calls.expired.push(id); return { id, status: "expired", payment_status: "unpaid" }; },
      },
    },
    refunds: { create: async () => ({ id: "re_1", amount: 0, currency: "usd", status: "succeeded", created: 1 }) },
  };
  const load = moduleLoader({
    "@/lib/db": { db, withDbRetry: (operation: () => Promise<unknown>) => operation() },
    "@/lib/auth": { auth: async () => (options.sessionUser === null || options.sessionUser === undefined
      ? null
      : { user: { id: options.sessionUser, email: "user@example.com" } }) },
    "@/lib/stripe": { stripe },
    "@/lib/logger": { logger: silentLogger },
    "@/lib/email": { sendOrderPlacedEmails: async () => {}, sendPaidCancelledOrderAlert: async () => {} },
    "@/lib/inventory-alerts": { notifyLowStock: async () => {}, rearmLowStockAlerts: async () => {} },
    "@/lib/rate-limit": {
      checkRateLimit: async (identifier: string, type: string) => {
        calls.rateLimits.push([identifier, type]);
        return options.rateLimit?.(identifier, type) ?? { success: true, remaining: 1, limit: 1, reset: 0 };
      },
    },
    "@prisma/client": { Prisma },
  });
  const { createOrderCheckout } = load("lib/create-order-checkout.ts");

  async function post(body: Record<string, unknown>, headers: Record<string, string> = {}) {
    const request = new Request("http://localhost/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ total: 20, items: [{ productId: PRODUCT_ID, quantity: 1, price: 20 }], ...body }),
    });
    const response = await createOrderCheckout(request);
    return { status: response.status, body: await response.json() as Record<string, any> };
  }
  return { post, state, calls, load };
}

const guestBody = { guestEmail: "ada@example.com", shippingAddress: address };

test("successful guest checkout keeps the response shape and stores a hashed client IP only", async () => {
  const { post, state } = setup();
  const { status, body } = await post(guestBody, { "x-vercel-forwarded-for": "203.0.113.7" });
  assert.equal(status, 200);
  assert.equal(body.url, "https://checkout.stripe.test/pay");
  assert.equal(typeof body.orderId, "string");
  assert.equal(typeof body.guestAccessToken, "string");
  const order = state.orders[0];
  assert.match(order.orderNumber, /^#\d{4}-\d{6}$/);
  assert.match(order.checkoutIpHash, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(order).includes("203.0.113.7"));
  assert.equal(state.products[0].stock, 9);

  const anonymous = setup();
  await anonymous.post(guestBody);
  assert.equal(anonymous.state.orders[0].checkoutIpHash, null, "no trusted IP, no hash");
});

test("an order-number conflict is retried with a fresh number (max 3 attempts)", async () => {
  const conflict = Object.assign(new Error("Unique constraint failed"), { code: "P2002", meta: { target: ["orderNumber"] } });
  const retried = setup();
  retried.state.orderCreateErrors.push(conflict);
  const { status, body } = await retried.post(guestBody);
  assert.equal(status, 200);
  assert.ok(body.orderId);
  assert.equal(retried.state.orders.length, 1);
  assert.equal(retried.state.orders[0].orderNumber.endsWith("000002"), true, "second attempt used a new number");
  assert.equal(retried.state.rawCalls.filter((call) => call.startsWith("execute:")).length, 1, "counter resynced once");
  assert.equal(retried.state.products[0].stock, 9);

  // Three conflicts in a row give up with a plain 500 and reserve nothing.
  const exhausted = setup();
  exhausted.state.orderCreateErrors.push(conflict, conflict, conflict);
  const failed = await exhausted.post(guestBody);
  assert.equal(failed.status, 500);
  assert.equal(failed.body.error, "Failed to create order");
  assert.equal(exhausted.state.orderCreateErrors.length, 0, "stopped after three attempts");
  assert.equal(exhausted.state.orders.length, 0);
});

test("previousCheckouts: foreign or invalid entries are ignored, owned unpaid ones are cancelled", async () => {
  const { createGuestOrderToken, hashGuestOrderToken } = moduleLoader({})("lib/guest-order-token.ts");
  const expires = new Date(Date.now() + 3_600_000);
  const guestOrderId = cuid("guest-prev");
  const guestToken = createGuestOrderToken(guestOrderId, expires);
  const foreignGuestId = cuid("guest-foreign");
  const foreignToken = createGuestOrderToken(foreignGuestId, expires);
  const userOrderId = cuid("user-prev");
  const otherUserOrderId = cuid("other-user-prev");
  const base = { status: "PENDING", total: new Prisma.Decimal("20.00"), currency: "USD", stripeCheckoutSessionId: null, createdAt: new Date() };
  const orders = [
    { id: guestOrderId, userId: null, guestEmail: "ada@example.com", guestAccessTokenHash: hashGuestOrderToken(guestToken), guestAccessTokenExpiresAt: expires, ...base },
    { id: foreignGuestId, userId: null, guestEmail: "someone@example.com", guestAccessTokenHash: hashGuestOrderToken(foreignToken), guestAccessTokenExpiresAt: expires, ...base },
    { id: userOrderId, userId: USER_ID, ...base },
    { id: otherUserOrderId, userId: OTHER_USER_ID, ...base },
  ];
  const items = orders.map((order, index) => ({ id: cuid(`pi${index}`), orderId: order.id, productId: PRODUCT_ID, quantity: 1, price: 20 }));

  // Guest: a valid token cancels; a wrong token, someone else's token and a user's order are ignored.
  const guest = setup({ orders, items, products: [{ id: PRODUCT_ID, name: "Mug", price: new Prisma.Decimal("20.00"), stock: 10, isArchived: false }] });
  const guestResult = await guest.post({
    ...guestBody,
    previousCheckouts: [
      { orderId: guestOrderId, guestAccessToken: guestToken },
      { orderId: foreignGuestId, guestAccessToken: guestToken },
      { orderId: userOrderId, guestAccessToken: guestToken },
      { orderId: cuid("does-not-exist"), guestAccessToken: "x" },
    ],
  });
  assert.equal(guestResult.status, 200);
  const status = (id: string) => guest.state.orders.find((order) => order.id === id)!.status;
  assert.equal(status(guestOrderId), "CANCELLED");
  assert.equal(status(foreignGuestId), "PENDING");
  assert.equal(status(userOrderId), "PENDING");
  assert.equal(guest.state.products[0].stock, 10 + 1 - 1, "one restocked, one reserved");

  // Logged in: only the user's own unpaid order is cancelled, no token needed.
  const member = setup({ orders, items, sessionUser: USER_ID, products: [{ id: PRODUCT_ID, name: "Mug", price: new Prisma.Decimal("20.00"), stock: 10, isArchived: false }] });
  const memberResult = await member.post({
    previousCheckouts: [{ orderId: userOrderId }, { orderId: otherUserOrderId }, { orderId: guestOrderId, guestAccessToken: guestToken }],
  });
  assert.equal(memberResult.status, 200);
  const memberStatus = (id: string) => member.state.orders.find((order) => order.id === id)!.status;
  assert.equal(memberStatus(userOrderId), "CANCELLED");
  assert.equal(memberStatus(otherUserOrderId), "PENDING");
  assert.equal(memberStatus(guestOrderId), "PENDING");
});

test("previousCheckouts: an already paid checkout stops the new one with 409 PREVIOUS_CHECKOUT_PAID", async () => {
  const { createGuestOrderToken, hashGuestOrderToken } = moduleLoader({})("lib/guest-order-token.ts");
  const expires = new Date(Date.now() + 3_600_000);
  const orderId = cuid("guest-paid");
  const token = createGuestOrderToken(orderId, expires);
  const paidSessionResponse = {
    id: "cs_paid", status: "complete", payment_status: "paid", amount_total: 2000, currency: "usd",
    payment_intent: "pi_paid", metadata: { orderId, deploymentId: "store-test" },
  };
  const orders = [{
    id: orderId, userId: null, guestEmail: "ada@example.com", status: "PENDING", total: new Prisma.Decimal("20.00"), currency: "USD",
    stripeCheckoutSessionId: "cs_paid", guestAccessTokenHash: hashGuestOrderToken(token), guestAccessTokenExpiresAt: expires, createdAt: new Date(),
  }];
  const items = [{ id: cuid("paid-item"), orderId, productId: PRODUCT_ID, quantity: 1, price: 20 }];

  const guest = setup({ orders, items, sessionRetrieve: () => paidSessionResponse });
  const result = await guest.post({ ...guestBody, previousCheckouts: [{ orderId, guestAccessToken: token }] });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, "PREVIOUS_CHECKOUT_PAID");
  assert.equal(result.body.orderId, orderId);
  assert.equal(result.body.guestAccessToken, token);
  assert.match(result.body.error, /already been paid/);
  assert.equal(guest.state.orders[0].status, "CONFIRMED");
  assert.equal(guest.calls.sessionsCreated.length, 0);

  const memberOrders = [{ ...orders[0], userId: USER_ID, guestEmail: null, guestAccessTokenHash: null }];
  const member = setup({ orders: memberOrders, items, sessionUser: USER_ID, sessionRetrieve: () => paidSessionResponse });
  const memberResult = await member.post({ previousCheckouts: [{ orderId }] });
  assert.equal(memberResult.status, 409);
  assert.equal(memberResult.body.code, "PREVIOUS_CHECKOUT_PAID");
  assert.equal("guestAccessToken" in memberResult.body, false);
});

test("per-IP cap on pending orders works without Redis and the hash is cleared once an order leaves PENDING", async () => {
  const ip = "203.0.113.9";
  const first = setup();
  const created = await first.post(guestBody, { "x-vercel-forwarded-for": ip });
  assert.equal(created.status, 200);
  const hash = first.state.orders[0].checkoutIpHash as string;

  const pending = Array.from({ length: 5 }, (_, index) => ({
    id: cuid(`pending${index}`), status: "PENDING", checkoutIpHash: hash, createdAt: new Date(Date.now() - 60_000),
    guestEmail: `other${index}@example.com`, userId: null,
  }));
  const capped = setup({ orders: pending });
  const blocked = await capped.post(guestBody, { "x-vercel-forwarded-for": ip });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.code, "TOO_MANY_PENDING");
  assert.equal(capped.state.products[0].stock, 10);

  const other = await capped.post(guestBody, { "x-vercel-forwarded-for": "203.0.113.10" });
  assert.equal(other.status, 200, "another network is not affected");

  const old = setup({ orders: pending.map((order) => ({ ...order, createdAt: new Date(Date.now() - 31 * 60_000) })) });
  assert.equal((await old.post(guestBody, { "x-vercel-forwarded-for": ip })).status, 200, "orders older than 30 minutes do not count");

  // Cancelling or confirming drops the hash.
  const { handleOrderCancellation, confirmOrder } = first.load("lib/order-confirmation.ts");
  const orderId = first.state.orders[0].id as string;
  assert.equal(await handleOrderCancellation(orderId), true);
  assert.equal(first.state.orders[0].checkoutIpHash, null);
  const second = setup();
  await second.post(guestBody, { "x-vercel-forwarded-for": ip });
  await second.load("lib/order-confirmation.ts").confirmOrder(second.state.orders[0].id, { paymentIntentId: "pi_x" }, null);
  assert.equal(second.state.orders[0].checkoutIpHash, null);
  void confirmOrder;
});

test("the IP rate limiter is applied in addition to the user limiter, except for unknown clients", async () => {
  const limited = setup({ rateLimit: (_id, type) => (type === "ordersIp" ? { success: false, remaining: 0, limit: 20, reset: 0 } : undefined) });
  const blocked = await limited.post(guestBody, { "x-vercel-forwarded-for": "203.0.113.11" });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.code, "RATE_LIMITED");
  assert.deepEqual(limited.calls.rateLimits.map(([, type]) => type), ["orders", "ordersIp"]);

  const anonymous = setup();
  await anonymous.post(guestBody);
  assert.deepEqual(anonymous.calls.rateLimits.map(([, type]) => type), ["orders"]);
});

test("totals below Stripe's minimum are rejected before any stock is reserved", async () => {
  const cheap = [{ id: PRODUCT_ID, name: "Sticker", price: new Prisma.Decimal("0.30"), stock: 10, isArchived: false }];
  const { post, state, calls } = setup({ products: cheap });
  const { status, body } = await post(guestBody);
  assert.equal(status, 400);
  assert.equal(body.code, "BELOW_MINIMUM_AMOUNT");
  assert.equal(body.minimumAmount, 0.5);
  assert.equal(body.currency, "USD");
  assert.match(body.error, /\$0\.50/);
  assert.equal(state.orders.length, 0);
  assert.equal(state.products[0].stock, 10);
  assert.equal(calls.sessionsCreated.length, 0);
});

test("Stripe amount_too_small releases the reservation and is reported as BELOW_MINIMUM_AMOUNT", async () => {
  const { post, state } = setup({
    settings: { currency: "ZAR", taxRate: 0, shippingCost: 0, freeShippingThreshold: 500, enabledCountries: [] },
    sessionCreate: () => { throw Object.assign(new Error("Amount must convert to at least 50 cents"), { code: "amount_too_small" }); },
  });
  const { status, body } = await post(guestBody);
  assert.equal(status, 400);
  assert.equal(body.code, "BELOW_MINIMUM_AMOUNT");
  assert.equal(body.currency, "ZAR");
  assert.equal(state.orders[0].status, "CANCELLED");
  assert.equal(state.products[0].stock, 10);
});

test("enabled shipping countries are enforced for new and saved addresses", async () => {
  const settings = { currency: "USD", taxRate: 0, shippingCost: 0, freeShippingThreshold: 500, enabledCountries: ["Germany", "France"] };
  const fr = { ...address, country: "FR" };
  const allowed = await setup({ settings }).post({ ...guestBody, shippingAddress: fr });
  assert.equal(allowed.status, 200);

  const rejected = setup({ settings });
  const result = await rejected.post({ ...guestBody, shippingAddress: { ...address, country: "IT" } });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, "COUNTRY_NOT_ENABLED");
  assert.equal(rejected.state.orders.length, 0);
  assert.equal(rejected.state.products[0].stock, 10);

  const savedBlocked = cuid("saved-it");
  const savedAllowed = cuid("saved-de");
  const addresses = [{ id: savedBlocked, userId: USER_ID, country: "IT" }, { id: savedAllowed, userId: USER_ID, country: "DE" }];
  const saved = setup({ settings, addresses, sessionUser: USER_ID });
  const blocked = await saved.post({ shippingAddressId: savedBlocked });
  assert.equal(blocked.status, 400);
  assert.equal(blocked.body.code, "COUNTRY_NOT_ENABLED");
  assert.equal((await saved.post({ shippingAddressId: savedAllowed })).status, 200);

  // No restriction configured: every country is accepted.
  assert.equal((await setup().post({ ...guestBody, shippingAddress: { ...address, country: "IT" } })).status, 200);
});

test("free shipping: null disables it, 0 makes it always free, missing settings use the default", async () => {
  const shippingLine = (calls: any[]) => calls[0].line_items.find((line: any) => line.price_data.product_data.name === "Shipping");
  const settings = (freeShippingThreshold: number | null) => ({ currency: "USD", taxRate: 0, shippingCost: 7, freeShippingThreshold, enabledCountries: [] });
  const rich = [{ id: PRODUCT_ID, name: "Desk", price: new Prisma.Decimal("900.00"), stock: 10, isArchived: false }];

  const disabled = setup({ settings: settings(null), products: rich });
  await disabled.post(guestBody);
  assert.equal(shippingLine(disabled.calls.sessionsCreated).price_data.unit_amount, 700, "never free when null");
  assert.equal(disabled.state.orders[0].shippingCost.toString(), "7");

  const always = setup({ settings: settings(0) });
  await always.post(guestBody);
  assert.equal(shippingLine(always.calls.sessionsCreated), undefined, "always free when 0");

  const threshold = setup({ settings: settings(500), products: rich });
  await threshold.post(guestBody);
  assert.equal(shippingLine(threshold.calls.sessionsCreated), undefined, "free above the threshold");
  const below = setup({ settings: settings(500) });
  await below.post(guestBody);
  assert.equal(shippingLine(below.calls.sessionsCreated).price_data.unit_amount, 700, "charged below the threshold");

  const invalid = await setup({ settings: settings(-1) }).post(guestBody);
  assert.equal(invalid.status, 500);
});

test("calculateCheckoutTotals free-shipping semantics", () => {
  const { calculateCheckoutTotals } = moduleLoader({ "@prisma/client": { Prisma } })("lib/checkout-totals.ts");
  const totals = (freeShippingThreshold: unknown, subtotal = 100) =>
    calculateCheckoutTotals({ currency: "USD", subtotal, taxRate: 0, shippingCost: 5, freeShippingThreshold });
  assert.equal(totals(null).shipping.toString(), "5");
  assert.equal(totals(undefined, 10_000).shipping.toString(), "5");
  assert.equal(totals(0).shipping.toString(), "0");
  assert.equal(totals(0, 0).shipping.toString(), "0");
  assert.equal(totals(100).shipping.toString(), "0");
  assert.equal(totals(100.01).shipping.toString(), "5");
});

test("every non-OK response carries { error, code } for the checkout UI", async () => {
  const invalid = await setup().post({ items: [] });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, "INVALID_INPUT");
  assert.equal(typeof invalid.body.error, "string");

  const stock = await setup().post({ ...guestBody, items: [{ productId: PRODUCT_ID, quantity: 11, price: 20 }] });
  assert.equal(stock.status, 409);
  assert.equal(stock.body.code, "INSUFFICIENT_STOCK");

  const unavailable = await setup().post({ ...guestBody, items: [{ productId: cuid("unknown"), quantity: 1, price: 20 }] });
  assert.equal(unavailable.status, 400);
  assert.equal(unavailable.body.code, "PRODUCT_UNAVAILABLE");

  const discount = await setup().post({ ...guestBody, discountCode: "NOPE" });
  assert.equal(discount.status, 400);
  assert.equal(discount.body.code, "INVALID_DISCOUNT");

  const failing = setup({ sessionCreate: () => { throw new Error("stripe down"); } });
  const init = await failing.post(guestBody);
  assert.equal(init.status, 502);
  assert.equal(init.body.code, "PAYMENT_INIT_FAILED");
  assert.equal(failing.state.products[0].stock, 10, "reservation released");

  const existing = await setup().post({ ...guestBody, checkoutRequestId: "11111111-1111-4111-8111-111111111111" });
  assert.equal(existing.status, 200);
  const reuse = setup({ orders: [{
    id: cuid("reuse"), checkoutRequestId: "11111111-1111-4111-8111-111111111111", userId: null, guestEmail: "victim@example.com",
    status: "PENDING", stripeCheckoutSessionId: "cs_1", guestAccessTokenExpiresAt: null, createdAt: new Date(),
  }] });
  const conflict = await reuse.post({ ...guestBody, checkoutRequestId: "11111111-1111-4111-8111-111111111111" });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, "CHECKOUT_REUSE_CONFLICT");

  const limited = await setup({ rateLimit: () => ({ success: false, remaining: 0, limit: 1, reset: 0 }) }).post(guestBody);
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, "RATE_LIMITED");

  const owner = setup({ orders: Array.from({ length: 3 }, (_, index) => ({
    id: cuid(`mine${index}`), status: "PENDING", guestEmail: "ada@example.com", userId: null, createdAt: new Date(),
  })) });
  const tooMany = await owner.post(guestBody);
  assert.equal(tooMany.status, 429);
  assert.equal(tooMany.body.code, "TOO_MANY_PENDING");
});
