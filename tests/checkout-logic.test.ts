import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateCheckoutTotals } from "../lib/checkout-totals";
import { createGuestOrderToken, hashGuestOrderToken, verifyGuestOrderToken } from "../lib/guest-order-token";
import { fromMinorUnits, toMinorUnits } from "../lib/money";
import { canTransitionOrder, isTerminalOrderStatus } from "../lib/order-state";
import { getTrustedClientIdentifier } from "../lib/request-identity";
import { checkRateLimit } from "../lib/rate-limit";
import { isAuthorizedCronRequest } from "../lib/cron-auth";
import { buildDiscountedProductLineItems } from "../lib/stripe-line-items";

function lineAmountMinor(line: ReturnType<typeof buildDiscountedProductLineItems>[number]): number {
  const priceData = line.price_data;
  if (!priceData || typeof priceData === "string" || priceData.unit_amount === null || priceData.unit_amount === undefined) {
    throw new Error("Expected an inline Stripe price with a unit amount");
  }
  return priceData.unit_amount * (line.quantity ?? 0);
}

test("calculates fixed discount, tax and paid shipping in Decimal/minor units", () => {
  const totals = calculateCheckoutTotals({
    currency: "USD",
    subtotal: "100.00",
    discount: { type: "FIXED", value: "10.00" },
    taxRate: "20",
    shippingCost: "5.00",
    freeShippingThreshold: "500.00",
  });

  assert.equal(totals.subtotal.toString(), "100");
  assert.equal(totals.discountAmount.toString(), "10");
  assert.equal(totals.tax.toString(), "18");
  assert.equal(totals.shipping.toString(), "5");
  assert.equal(totals.total.toString(), "113");
  assert.equal(totals.totalMinor, 11300);
});

test("calculates percentage discount and free shipping threshold", () => {
  const totals = calculateCheckoutTotals({
    currency: "USD",
    subtotal: "600.00",
    discount: { type: "PERCENT", value: "15" },
    taxRate: "8.25",
    shippingCost: "12.00",
    freeShippingThreshold: "500.00",
  });

  assert.equal(totals.discountAmount.toString(), "90");
  assert.equal(totals.discountedSubtotal.toString(), "510");
  assert.equal(totals.tax.toString(), "42.08");
  assert.equal(totals.shipping.toString(), "0");
  assert.equal(totals.total.toString(), "552.08");
  assert.equal(totals.totalMinor, 55208);
});

test("supports zero-decimal currencies and zero-total orders", () => {
  const jpy = calculateCheckoutTotals({
    currency: "JPY",
    subtotal: "1000",
    discount: { type: "PERCENT", value: "100" },
    taxRate: "10",
    shippingCost: "0",
    freeShippingThreshold: "500",
  });
  assert.equal(jpy.discountAmount.toString(), "1000");
  assert.equal(jpy.tax.toString(), "0");
  assert.equal(jpy.total.toString(), "0");
  assert.equal(jpy.totalMinor, 0);

  assert.equal(toMinorUnits("19.99", "USD"), 1999);
  assert.equal(toMinorUnits("1999", "JPY"), 1999);
  assert.equal(fromMinorUnits(1999, "JPY").toString(), "1999");
});

test("allocates the exact discount across product lines without discounting tax or shipping", () => {
  const lines = buildDiscountedProductLineItems("USD", [
    { name: "First", unitAmountMinor: 1000, quantity: 2 },
    { name: "Second", unitAmountMinor: 500, quantity: 1 },
  ], 700);

  assert.equal(lines.reduce((total, line) => total + lineAmountMinor(line), 0), 1800);
  assert.equal(lines.reduce((total, line) => total + (line.quantity ?? 0), 0), 3);
  assert.ok(lines.every((line) => line.price_data && typeof line.price_data !== "string"));
});

test("keeps largest-remainder allocation exact for small final lines", () => {
  const lines = buildDiscountedProductLineItems("USD", [
    { name: "Tiny A", unitAmountMinor: 1, quantity: 1 },
    { name: "Tiny B", unitAmountMinor: 1, quantity: 1 },
    { name: "Large", unitAmountMinor: 100, quantity: 1 },
  ], 2);

  assert.equal(lines.reduce((total, line) => total + lineAmountMinor(line), 0), 100);
  assert.ok(lines.every((line) => {
    const priceData = line.price_data;
    return Boolean(priceData && typeof priceData !== "string" && (priceData.unit_amount ?? 0) >= 0);
  }));
});

test("enforces order state transitions and terminal refund states", () => {
  assert.equal(canTransitionOrder("PENDING", "CANCELLED", false), true);
  assert.equal(canTransitionOrder("PENDING", "CONFIRMED", true), false);
  assert.equal(canTransitionOrder("CONFIRMED", "PROCESSING", true), true);
  assert.equal(canTransitionOrder("PROCESSING", "SHIPPED", true), true);
  assert.equal(canTransitionOrder("SHIPPED", "DELIVERED", true), true);
  assert.equal(canTransitionOrder("DELIVERED", "CANCELLED", true), false);
  assert.equal(isTerminalOrderStatus("PARTIALLY_REFUNDED"), true);
  assert.equal(isTerminalOrderStatus("REFUNDED"), true);
});

test("accepts only the signed guest token stored for the order", () => {
  const previousSecret = process.env.GUEST_ORDER_TOKEN_SECRET;
  process.env.GUEST_ORDER_TOKEN_SECRET = "test-secret-that-is-at-least-32-characters-long";

  try {
    const orderId = "order_test_123";
    const expiresAt = new Date(Date.now() + 60_000);
    const token = createGuestOrderToken(orderId, expiresAt);
    const tokenHash = hashGuestOrderToken(token);

    assert.equal(verifyGuestOrderToken(token, orderId, tokenHash, expiresAt), true);
    assert.equal(verifyGuestOrderToken(`${token}tampered`, orderId, tokenHash, expiresAt), false);
    assert.equal(verifyGuestOrderToken(token, "another-order", tokenHash, expiresAt), false);
    assert.equal(
      verifyGuestOrderToken(token, orderId, tokenHash, new Date(Date.now() - 1_000)),
      false,
    );
  } finally {
    if (previousSecret === undefined) delete process.env.GUEST_ORDER_TOKEN_SECRET;
    else process.env.GUEST_ORDER_TOKEN_SECRET = previousSecret;
  }
});

test("uses only the Vercel-managed client IP for rate-limit identity", () => {
  const forgedHeaders = new Headers({
    "x-forwarded-for": "203.0.113.10",
    "x-real-ip": "203.0.113.11",
  });
  assert.equal(getTrustedClientIdentifier(new Request("https://store.test", { headers: forgedHeaders })), "anonymous");

  const vercelHeaders = new Headers({
    "x-vercel-forwarded-for": "2001:db8::10, 203.0.113.12",
    "x-forwarded-for": "203.0.113.13",
  });
  assert.equal(getTrustedClientIdentifier(new Request("https://store.test", { headers: vercelHeaders })), "2001:db8::10");
});

test("allows external WAF mode when Upstash is not configured", async () => {
  const previousUrl = process.env.UPSTASH_REDIS_REST_URL;
  const previousToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;

  try {
    const result = await checkRateLimit("anonymous", "orders");
    assert.equal(result.success, true);
    assert.equal(result.unavailable, undefined);
  } finally {
    if (previousUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = previousUrl;
    if (previousToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = previousToken;
  }
});

test("fails closed outside development when Upstash configuration is incomplete", async () => {
  const mutableEnv = process.env as Record<string, string | undefined>;
  const previousUrl = process.env.UPSTASH_REDIS_REST_URL;
  const previousToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const previousNodeEnv = process.env.NODE_ENV;

  mutableEnv.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
  delete mutableEnv.UPSTASH_REDIS_REST_TOKEN;
  mutableEnv.NODE_ENV = "test";

  try {
    const result = await checkRateLimit("anonymous", "orders");
    assert.equal(result.success, false);
    assert.equal(result.unavailable, true);
    assert.equal(result.limit, 0);
  } finally {
    if (previousUrl === undefined) delete mutableEnv.UPSTASH_REDIS_REST_URL;
    else mutableEnv.UPSTASH_REDIS_REST_URL = previousUrl;
    if (previousToken === undefined) delete mutableEnv.UPSTASH_REDIS_REST_TOKEN;
    else mutableEnv.UPSTASH_REDIS_REST_TOKEN = previousToken;
    if (previousNodeEnv === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = previousNodeEnv;
  }
});

test("authorizes cron requests with a timing-safe bearer secret", () => {
  const previousSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "cron-secret-for-tests";

  try {
    assert.equal(
      isAuthorizedCronRequest(new Request("https://store.test", {
        headers: { authorization: "Bearer cron-secret-for-tests" },
      })),
      true,
    );
    assert.equal(
      isAuthorizedCronRequest(new Request("https://store.test", {
        headers: { authorization: "Bearer wrong-secret" },
      })),
      false,
    );
    assert.equal(isAuthorizedCronRequest(new Request("https://store.test")), false);
  } finally {
    if (previousSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
  }
});
