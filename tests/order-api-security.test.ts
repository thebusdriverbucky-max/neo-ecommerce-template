import assert from "node:assert/strict";
import test from "node:test";
import { moduleLoader } from "./helpers/load-module";

test("order PATCH is admin-only even for the order owner", async () => {
  let transitions = 0;
  const load = moduleLoader({
    "@/lib/auth": { auth: async () => ({ user: { id: "owner", role: "CUSTOMER" } }) },
    "@/lib/db": { db: {} },
    "@/lib/manual-order": {
      OrderConflictError: class extends Error {},
      OrderInputError: class extends Error {},
      transitionManualOrder: async () => { transitions++; },
    },
    "@/lib/email": { sendOrderStatusUpdateEmail: async () => null },
  });
  const response = await load("app/api/orders/[id]/route.ts").PATCH(
    new Request("https://store.example.test/api/orders/o1", { method: "PATCH", body: JSON.stringify({ status: "CONFIRMED" }) }),
    { params: { id: "o1" } },
  );
  assert.equal(response.status, 403);
  assert.equal(transitions, 0);
});

test("admin PATCH delegates a validated transition and records admin identity", async () => {
  let transition: any;
  const load = moduleLoader({
    "@/lib/auth": { auth: async () => ({ user: { id: "admin-1", role: "ADMIN" } }) },
    "@/lib/db": { db: {} },
    "@/lib/manual-order": {
      OrderConflictError: class extends Error {},
      OrderInputError: class extends Error {},
      transitionManualOrder: async (_db: any, input: any) => {
        transition = input;
        return { id: "o1", orderNumber: "#1", userId: "u1", user: { email: null }, guestEmail: null, status: input.nextStatus, trackingNumber: null };
      },
    },
    "@/lib/email": { sendOrderStatusUpdateEmail: async () => null },
  });
  const response = await load("app/api/orders/[id]/route.ts").PATCH(
    new Request("https://store.example.test/api/orders/o1", { method: "PATCH", body: JSON.stringify({ status: "CONFIRMED" }) }),
    { params: { id: "o1" } },
  );
  assert.equal(response.status, 200);
  assert.equal(transition.adminUserId, "admin-1");
  assert.equal(transition.nextStatus, "CONFIRMED");
});

test("guest checkout fails closed before order creation when signed links are unavailable", async () => {
  let created = 0;
  const load = moduleLoader({
    "@/lib/auth": { auth: async () => null },
    "@/lib/db": { db: { user: { findUnique: async () => null } } },
    "@/lib/rate-limit": { checkRateLimit: async () => ({ success: true }) },
    "@/lib/request-identity": { getTrustedClientIdentifier: () => "guest" },
    "@/lib/guest-order-token": { guestOrderTokensConfigured: () => false, createGuestOrderToken: () => "never" },
    "@/lib/manual-order": {
      OrderConflictError: class extends Error {},
      OrderInputError: class extends Error {},
      OrderConfigurationError: class extends Error {},
      createManualOrder: async () => { created++; },
    },
    "@/lib/email": {},
  });
  const response = await load("app/api/orders/route.ts").POST(new Request("https://store.example.test/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "request_12345678" },
    body: JSON.stringify({
      items: [{ productId: "ck1234567890123456789012", quantity: 1 }],
      guestEmail: "guest@example.test",
      shippingAddress: { firstName: "A", lastName: "B", email: "guest@example.test", phone: "+12345", street: "S", city: "C", state: "", postalCode: "P", country: "DE" },
    }),
  }));
  assert.equal(response.status, 503);
  assert.equal(created, 0);
});

test("expiration cron requires an exact Bearer secret", async () => {
  let calls = 0;
  process.env.CRON_SECRET = "isolated-cron-secret";
  try {
    const load = moduleLoader({
      "@/lib/db": { db: {} },
      "@/lib/manual-order": { expirePendingOrders: async () => ++calls },
    });
    const { POST, GET } = load("app/api/cron/orders/expire/route.ts");
    assert.equal((await POST(new Request("https://store.example.test/api/cron/orders/expire", { method: "POST" }))).status, 401);
    assert.equal((await POST(new Request("https://store.example.test/api/cron/orders/expire", { method: "POST", headers: { authorization: "Bearer wrong" } }))).status, 401);
    const response = await POST(new Request("https://store.example.test/api/cron/orders/expire", { method: "POST", headers: { authorization: "Bearer isolated-cron-secret" } }));
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
    assert.equal((await GET(new Request("https://store.example.test/api/cron/orders/expire", { headers: { authorization: "Bearer isolated-cron-secret" } }))).status, 200);
    assert.equal(calls, 2);
  } finally {
    delete process.env.CRON_SECRET;
  }
});
