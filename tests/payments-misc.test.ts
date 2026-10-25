import assert from "node:assert/strict";
import test from "node:test";
import { createOrderSchema } from "../lib/validations";
import { createGuestOrderTokenExpiry, createGuestOrderToken, hashGuestOrderToken, verifyGuestOrderToken } from "../lib/guest-order-token";
import { hashClientIdentifier } from "../lib/request-identity";

process.env.GUEST_ORDER_TOKEN_SECRET = "test-guest-secret-test-guest-secret-0123456789";

const base = { items: [{ productId: "cjld2cjxh0000qzrmn831i7rn", quantity: 1, price: 5 }], total: 5 };
const orderId = "cjld2cjxh0000qzrmn831i7rm";

test("new guest order links stay valid for 90 days", () => {
  const days = (createGuestOrderTokenExpiry().getTime() - Date.now()) / 86_400_000;
  assert.ok(days > 89.99 && days <= 90);
  const expiresAt = createGuestOrderTokenExpiry();
  const token = createGuestOrderToken(orderId, expiresAt);
  assert.equal(verifyGuestOrderToken(token, orderId, hashGuestOrderToken(token), expiresAt), true);
  assert.equal(verifyGuestOrderToken(token, orderId, hashGuestOrderToken(token), new Date(Date.now() - 1000)), false);
});

test("createOrderSchema accepts up to 5 previous checkouts and rejects malformed entries", () => {
  const entry = { orderId, guestAccessToken: "a.b.c" };
  assert.equal(createOrderSchema.safeParse(base).success, true);
  assert.equal(createOrderSchema.safeParse({ ...base, previousCheckouts: Array(5).fill(entry) }).success, true);
  assert.equal(createOrderSchema.safeParse({ ...base, previousCheckouts: Array(6).fill(entry) }).success, false);
  assert.equal(createOrderSchema.safeParse({ ...base, previousCheckouts: [{ orderId: "nope" }] }).success, false);
  assert.equal(createOrderSchema.safeParse({ ...base, previousCheckouts: [{ orderId, guestAccessToken: "x".repeat(301) }] }).success, false);
  assert.equal(createOrderSchema.safeParse({ ...base, previousCheckouts: [{ orderId }] }).success, true);
});

test("client IP hash is a keyed, stable HMAC and never exposes the address", () => {
  const hash = hashClientIdentifier("203.0.113.7");
  assert.match(hash || "", /^[0-9a-f]{64}$/);
  assert.equal(hash, hashClientIdentifier("203.0.113.7"));
  assert.notEqual(hash, hashClientIdentifier("203.0.113.8"));
  assert.equal(hashClientIdentifier("anonymous"), null);
  const previous = process.env.GUEST_ORDER_TOKEN_SECRET;
  process.env.GUEST_ORDER_TOKEN_SECRET = "another-secret-another-secret-0123456789";
  assert.notEqual(hashClientIdentifier("203.0.113.7"), hash);
  process.env.GUEST_ORDER_TOKEN_SECRET = previous;
});
