import assert from "node:assert/strict";
import test from "node:test";
import { moduleLoader } from "./helpers/load-module";

class OrderConflictError extends Error {}
class OrderInputError extends Error {}
class OrderConfigurationError extends Error {}
class OrderLimitError extends Error {}
const INTERNAL_ORDER_FIELDS = { checkoutRequestId: true, requestFingerprint: true, checkoutIpHash: true };
const orderErrors = { OrderConflictError, OrderInputError, OrderConfigurationError, OrderLimitError, INTERNAL_ORDER_FIELDS };

const SETTINGS = { storeName: "Store", currency: "EUR" };

function patchRequest(body: unknown) {
  return new Request("https://store.example.test/api/orders/o1", { method: "PATCH", body: JSON.stringify(body) });
}

function loadOrderRoute(options: {
  role?: string;
  stored?: Record<string, unknown> | null;
  transition?: (input: any) => any;
  tracking?: (input: any) => any;
  emailFails?: boolean;
} = {}) {
  const role = options.role || "ADMIN";
  const calls = { transitions: [] as any[], tracking: [] as any[], emails: [] as any[], lowStock: [] as any[] };
  const stored = options.stored === undefined
    ? { id: "o1", status: "PENDING", trackingNumber: null, reservationExpiresAt: new Date("2030-01-08T00:00:00Z") }
    : options.stored;
  const detail = (status: string, trackingNumber: string | null = null) => ({
    id: "o1", orderNumber: "#2030-ABC", userId: "u1", guestEmail: null, status, trackingNumber,
    user: { id: "u1", name: "C", email: "customer@example.test" },
    items: [{ productId: "p1", quantity: 1, product: { name: "P" } }],
  });
  const load = moduleLoader({
    "@/lib/auth": { auth: async () => ({ user: { id: role === "ADMIN" ? "admin-1" : "owner", role } }) },
    "@/lib/db": { db: { order: { findUnique: async () => stored } } },
    "@/lib/manual-order": {
      ...orderErrors,
      transitionManualOrder: async (_db: unknown, input: any) => {
        calls.transitions.push(input);
        return options.transition ? options.transition(input) : detail(input.nextStatus, input.trackingNumber ?? null);
      },
      updateOrderTracking: async (_db: unknown, input: any) => {
        calls.tracking.push(input);
        return options.tracking ? options.tracking(input) : detail(String(stored?.status), input.trackingNumber);
      },
    },
    "@/lib/email": {
      sendOrderStatusEmail: async (...args: unknown[]) => {
        calls.emails.push(args);
        if (options.emailFails) throw new Error("provider down");
      },
    },
    "@/lib/inventory-alerts": {
      notifyLowStock: async (ids: string[]) => { calls.lowStock.push(ids); },
      rearmLowStockAlerts: async () => {},
    },
    "@/lib/store-settings": { getStoreSettings: async () => SETTINGS },
  });
  return { route: load("app/api/orders/[id]/route.ts"), calls };
}

test("order PATCH is admin-only even for the order owner", async () => {
  const { route, calls } = loadOrderRoute({ role: "CUSTOMER" });
  const response = await route.PATCH(patchRequest({ status: "CONFIRMED" }), { params: { id: "o1" } });
  assert.equal(response.status, 403);
  assert.equal(calls.transitions.length, 0);
});

test("admin PATCH delegates a validated transition, then emails and checks low stock after payment", async () => {
  const { route, calls } = loadOrderRoute();
  const response = await route.PATCH(patchRequest({ status: "CONFIRMED" }), { params: { id: "o1" } });
  assert.equal(response.status, 200);
  const [transition] = calls.transitions;
  assert.equal(transition.adminUserId, "admin-1");
  assert.equal(transition.nextStatus, "CONFIRMED");
  assert.equal(transition.recoverExpired, false);
  assert.equal(typeof transition.onStockReleased, "function");
  assert.equal(calls.emails.length, 1);
  assert.equal(calls.emails[0][0], "customer@example.test");
  assert.equal(calls.emails[0][2], SETTINGS);
  assert.deepEqual(calls.lowStock, [["p1"]]);
});

test("a committed status change still succeeds when the email provider fails", async () => {
  const { route, calls } = loadOrderRoute({ emailFails: true, stored: { id: "o1", status: "CONFIRMED", trackingNumber: null, reservationExpiresAt: new Date() } });
  const original = console.warn;
  console.warn = () => {};
  try {
    const response = await route.PATCH(patchRequest({ status: "SHIPPED", trackingNumber: "TRK-1" }), { params: { id: "o1" } });
    assert.equal(response.status, 200);
  } finally {
    console.warn = original;
  }
  assert.equal(calls.transitions[0].trackingNumber, "TRK-1");
  assert.equal(calls.lowStock.length, 0);
});

test("tracking can be edited on its own; an unchanged form is rejected", async () => {
  const shipped = { id: "o1", status: "SHIPPED", trackingNumber: null, reservationExpiresAt: new Date() };
  const { route, calls } = loadOrderRoute({ stored: shipped });
  const response = await route.PATCH(patchRequest({ status: "SHIPPED", trackingNumber: "  TRK-9  " }), { params: { id: "o1" } });
  assert.equal(response.status, 200);
  assert.equal(calls.transitions.length, 0);
  assert.deepEqual(calls.tracking, [{ orderId: "o1", trackingNumber: "TRK-9" }]);
  assert.equal(calls.emails.length, 1);

  const unchanged = await route.PATCH(patchRequest({ status: "SHIPPED" }), { params: { id: "o1" } });
  assert.equal(unchanged.status, 400);
  assert.equal((await unchanged.json()).error, "No changes to save");

  const cleared = loadOrderRoute({ stored: { ...shipped, trackingNumber: "TRK-1" } });
  assert.equal((await cleared.route.PATCH(patchRequest({ trackingNumber: "" }), { params: { id: "o1" } })).status, 200);
  assert.deepEqual(cleared.calls.tracking, [{ orderId: "o1", trackingNumber: null }]);
  assert.equal(cleared.calls.emails.length, 0);
});

test("paid orders are refunded, not cancelled; unknown, non-manual and invalid moves are rejected", async () => {
  const paid = loadOrderRoute({ stored: { id: "o1", status: "CONFIRMED", trackingNumber: null, reservationExpiresAt: new Date() } });
  const cancelled = await paid.route.PATCH(patchRequest({ status: "CANCELLED" }), { params: { id: "o1" } });
  assert.equal(cancelled.status, 409);
  assert.match((await cancelled.json()).error, /Refunded/);
  assert.equal(paid.calls.transitions.length, 0);

  for (const stored of [null, { id: "o1", status: "CONFIRMED", trackingNumber: null, reservationExpiresAt: null }]) {
    const { route } = loadOrderRoute({ stored });
    assert.equal((await route.PATCH(patchRequest({ status: "SHIPPED" }), { params: { id: "o1" } })).status, 404);
  }

  const invalid = loadOrderRoute({ transition: (input) => { throw new Error(`Invalid order transition: PENDING -> ${input.nextStatus}`); } });
  assert.equal((await invalid.route.PATCH(patchRequest({ status: "SHIPPED" }), { params: { id: "o1" } })).status, 409);
  const conflict = loadOrderRoute({ transition: () => { throw new OrderConflictError("Order was changed by another request"); } });
  assert.equal((await conflict.route.PATCH(patchRequest({ status: "CONFIRMED" }), { params: { id: "o1" } })).status, 409);
  assert.equal((await conflict.route.PATCH(patchRequest({ status: "LOST" }), { params: { id: "o1" } })).status, 400);
  assert.equal((await conflict.route.PATCH(patchRequest({ trackingNumber: "x".repeat(201) }), { params: { id: "o1" } })).status, 400);
});

test("a refund passes the restock choice through to the order engine", async () => {
  const { route, calls } = loadOrderRoute({ stored: { id: "o1", status: "PROCESSING", trackingNumber: null, reservationExpiresAt: new Date() } });
  const response = await route.PATCH(patchRequest({ status: "REFUNDED", restock: true }), { params: { id: "o1" } });
  assert.equal(response.status, 200);
  assert.equal(calls.transitions[0].restock, true);
  assert.equal(calls.emails.length, 1);
});

test("order GET hides checkout internals and who confirmed the payment from customers", async () => {
  for (const [role, hideConfirmer] of [["CUSTOMER", true], ["ADMIN", false]] as const) {
    let args: any;
    const load = moduleLoader({
      "@/lib/auth": { auth: async () => ({ user: { id: "u1", role } }) },
      "@/lib/db": { db: { order: { findUnique: async (input: any) => {
        args = input;
        return { id: "o1", userId: "u1", reservationExpiresAt: new Date() };
      } } } },
      "@/lib/manual-order": { ...orderErrors },
      "@/lib/email": {},
      "@/lib/inventory-alerts": {},
      "@/lib/store-settings": {},
    });
    const response = await load("app/api/orders/[id]/route.ts").GET(
      Object.assign(new Request("https://store.example.test/api/orders/o1"), { nextUrl: new URL("https://store.example.test/api/orders/o1") }),
      { params: { id: "o1" } },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(args.omit, { ...INTERNAL_ORDER_FIELDS, paymentConfirmedBy: hideConfirmer });
    assert.equal(args.include.user.select.password, undefined);
  }
});

function checkoutRequest() {
  return new Request("https://store.example.test/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "request_12345678" },
    body: JSON.stringify({
      items: [{ productId: "ck1234567890123456789012", quantity: 1 }],
      guestEmail: "guest@example.test",
      shippingAddress: { firstName: "A", lastName: "B", email: "guest@example.test", phone: "+12345", street: "S", city: "C", state: "", postalCode: "P", country: "DE" },
    }),
  });
}

function loadCheckout(options: { tokens?: boolean; create?: (input: any) => any; emailFails?: boolean } = {}) {
  const calls = { created: [] as any[], emails: 0, cleanups: 0 };
  const load = moduleLoader({
    "@/lib/auth": { auth: async () => null },
    "@/lib/db": { db: {
      user: { findUnique: async () => null },
      order: { findUnique: async () => ({ id: "o1", items: [], user: null, shippingAddress: null }) },
    } },
    "@/lib/rate-limit": { checkRateLimit: async () => ({ success: true }) },
    "@/lib/request-identity": { getTrustedClientIdentifier: () => "203.0.113.9", hashClientIdentifier: (value: string) => `hash:${value}` },
    "@/lib/guest-order-token": { guestOrderTokensConfigured: () => options.tokens ?? true, createGuestOrderToken: () => "signed" },
    "@/lib/manual-order": {
      ...orderErrors,
      createManualOrder: async (_db: unknown, input: any) => {
        calls.created.push(input);
        return options.create ? options.create(input) : { orderId: "o1", paymentIban: "DE001", paymentDetails: null, replayed: false };
      },
    },
    "@/lib/email": { sendOrderPlacedEmails: async () => {
      calls.emails += 1;
      if (options.emailFails) throw new Error("provider down");
    } },
    "@/lib/reservation-cleanup": { releaseExpiredReservationsSafely: async () => { calls.cleanups += 1; } },
    "@/lib/store-settings": { getStoreSettings: async () => SETTINGS },
  });
  return { route: load("app/api/orders/route.ts"), calls };
}

test("guest checkout fails closed before order creation when signed links are unavailable", async () => {
  const { route, calls } = loadCheckout({ tokens: false });
  const response = await route.POST(checkoutRequest());
  assert.equal(response.status, 503);
  assert.equal(calls.created.length, 0);
});

test("checkout passes the hashed client, survives email failures and maps the reservation cap to 429", async () => {
  const placed = loadCheckout({ emailFails: true });
  const original = console.warn;
  console.warn = () => {};
  try {
    const response = await placed.route.POST(checkoutRequest());
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.orderUrl, "/orders/o1?token=signed");
  } finally {
    console.warn = original;
  }
  assert.equal(placed.calls.created[0].checkoutIpHash, "hash:203.0.113.9");
  assert.equal(placed.calls.cleanups, 1);
  assert.equal(placed.calls.emails, 1);

  const replay = loadCheckout({ create: () => ({ orderId: "o1", paymentIban: null, paymentDetails: null, replayed: true }) });
  const replayed = await replay.route.POST(checkoutRequest());
  assert.equal(replayed.status, 200);
  assert.equal(replay.calls.emails, 0);
  assert.ok((await replayed.json()).paymentFallbackMessage);

  const capped = loadCheckout({ create: () => { throw new OrderLimitError("You already have several unpaid orders."); } });
  const limited = await capped.route.POST(checkoutRequest());
  assert.equal(limited.status, 429);
  assert.match((await limited.json()).error, /unpaid orders/);
});

test("admin order list keeps the legacy array and supports server pagination and filters", async () => {
  const queries: any[] = [];
  const load = (role: string) => moduleLoader({
    "@/lib/auth": { auth: async () => ({ user: { id: "u1", role } }) },
    "@/lib/db": { db: { order: {
      findMany: async (args: any) => { queries.push(args); return [{ id: "o1" }]; },
      count: async () => 31,
    } } },
    "@/lib/manual-order": { ...orderErrors },
    "@/lib/email": {},
    "@/lib/rate-limit": {},
    "@/lib/request-identity": {},
    "@/lib/guest-order-token": {},
    "@/lib/reservation-cleanup": { releaseExpiredReservationsSafely: async () => {} },
    "@/lib/store-settings": {},
  })("app/api/orders/route.ts");
  const get = (role: string, search = "") => {
    const url = new URL(`https://store.example.test/api/orders${search}`);
    return load(role).GET(Object.assign(new Request(url), { nextUrl: url }));
  };

  assert.equal((await get("CUSTOMER")).status, 401);
  const legacy = await get("ADMIN");
  assert.deepEqual(await legacy.json(), [{ id: "o1" }]);
  assert.deepEqual(queries[0].where, { reservationExpiresAt: { not: null } });
  assert.deepEqual(queries[0].omit, INTERNAL_ORDER_FIELDS);
  assert.equal(queries[0].take, undefined);

  const paged = await get("ADMIN", "?page=2&pageSize=10&status=PENDING&q=%232030");
  assert.deepEqual(await paged.json(), { orders: [{ id: "o1" }], total: 31, page: 2, pageSize: 10 });
  assert.equal(queries[1].skip, 10);
  assert.equal(queries[1].take, 10);
  assert.equal(queries[1].where.status, "PENDING");
  assert.deepEqual(queries[1].where.reservationExpiresAt, { not: null });
  assert.equal(queries[1].where.OR.length, 3);
  assert.equal((await get("ADMIN", "?status=LOST")).status, 400);
});

test("reservation cleanup needs no cron secret, re-arms stock alerts and storefront failures remain non-blocking", async () => {
  let calls = 0;
  let fails = false;
  let options: any;
  const load = moduleLoader({
    "@/lib/db": { db: {} },
    "@/lib/inventory-alerts": { rearmLowStockAlerts: async () => {} },
    "@/lib/manual-order": { expirePendingOrders: async (_db: unknown, _now: Date, _limit: number, opts: any) => {
      calls += 1;
      options = opts;
      if (fails) throw new Error("temporary cleanup race");
      return 2;
    } },
  });
  const cleanup = load("lib/reservation-cleanup.ts");
  assert.equal(await cleanup.releaseExpiredReservations(), 2);
  assert.equal(typeof options.onStockReleased, "function");
  fails = true;
  const original = console.warn;
  console.warn = () => {};
  try {
    await cleanup.releaseExpiredReservationsForStorefront();
    await cleanup.releaseExpiredReservationsSafely();
  } finally {
    console.warn = original;
  }
  assert.equal(calls, 3);
});
