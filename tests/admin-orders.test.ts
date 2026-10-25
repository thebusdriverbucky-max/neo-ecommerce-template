import assert from "node:assert/strict";
import test from "node:test";
import { moduleLoader } from "./helpers/load-module";
import {
  allowedStatusOptions,
  buildOrderPatch,
  isFreeOrder,
  orderPaymentActions,
  orderStatusHint,
  orderStatusLabel,
  ORDER_STATUSES,
} from "../lib/admin-orders";

function ordersRoute(role: string | null, calls: any[] = []) {
  const load = moduleLoader({
    "@/lib/auth": { auth: async () => (role ? { user: { id: "admin-1", role } } : null) },
    "@/lib/create-order-checkout": { createOrderCheckout: async () => new Response("checkout") },
    "@/lib/db": {
      db: {
        order: {
          findMany: async (args: any) => {
            calls.push(["findMany", args]);
            return [{ id: "o2" }, { id: "o1" }];
          },
          count: async (args: any) => {
            calls.push(["count", args]);
            return 230;
          },
        },
      },
    },
  });
  return load("app/api/orders/route.ts");
}

const get = (route: any, query = "") => route.GET(new Request(`http://localhost/api/orders${query}`));

test("orders GET requires an admin session", async () => {
  for (const role of [null, "CUSTOMER"]) {
    const calls: any[] = [];
    assert.equal((await get(ordersRoute(role, calls))).status, 401);
    assert.equal(calls.length, 0);
  }
});

test("orders GET without page keeps the legacy array response", async () => {
  const calls: any[] = [];
  const response = await get(ordersRoute("ADMIN", calls));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(Array.isArray(body));
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].skip, undefined);
  assert.equal(calls[0][1].take, undefined);
  assert.deepEqual(calls[0][1].orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
});

test("orders GET paginates, clamps pageSize and filters by status and search", async () => {
  const calls: any[] = [];
  const route = ordersRoute("ADMIN", calls);
  const response = await get(route, "?page=3&pageSize=500&status=PENDING&q=%20Smith%20");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { orders: [{ id: "o2" }, { id: "o1" }], total: 230, page: 3, pageSize: 100 });

  const find = calls.find(([name]) => name === "findMany")![1];
  const count = calls.find(([name]) => name === "count")![1];
  assert.equal(find.skip, 200);
  assert.equal(find.take, 100);
  assert.deepEqual(find.orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
  assert.equal(find.where.status, "PENDING");
  assert.deepEqual(find.where.OR, [
    { orderNumber: { contains: "Smith", mode: "insensitive" } },
    { guestEmail: { contains: "Smith", mode: "insensitive" } },
    { user: { is: { email: { contains: "Smith", mode: "insensitive" } } } },
  ]);
  assert.deepEqual(count.where, find.where);
});

test("orders GET sanitizes malformed paging and rejects unknown statuses", async () => {
  const calls: any[] = [];
  const route = ordersRoute("ADMIN", calls);
  const body = await (await get(route, "?page=abc&pageSize=0")).json();
  assert.equal(body.page, 1);
  assert.equal(body.pageSize, 25);
  const bad = await get(route, "?page=1&status=SHIPPING");
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /status/i);
});

test("status picker only offers the current status and forward fulfilment steps", () => {
  const values = (status: string) => allowedStatusOptions(status).map(option => option.value);
  // Cancelling and refunding are separate actions, never a status choice.
  assert.deepEqual(values("PENDING"), ["PENDING"]);
  assert.deepEqual(values("CONFIRMED"), ["CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED"]);
  assert.deepEqual(values("PROCESSING"), ["PROCESSING", "SHIPPED", "DELIVERED"]);
  assert.deepEqual(values("SHIPPED"), ["SHIPPED", "DELIVERED"]);
  assert.deepEqual(values("PARTIALLY_REFUNDED"), ["PARTIALLY_REFUNDED", "PROCESSING", "SHIPPED", "DELIVERED"]);
  for (const terminal of ["DELIVERED", "CANCELLED", "REFUNDED"]) {
    assert.deepEqual(values(terminal), [terminal]);
  }
  for (const status of ORDER_STATUSES) {
    assert.ok(!values(status).slice(1).includes("CANCELLED"), status);
    assert.notEqual(orderStatusLabel(status), "");
    assert.notEqual(orderStatusHint(status), "", status);
  }
  assert.equal(allowedStatusOptions("PARTIALLY_REFUNDED")[0].label, "Partially refunded");
  assert.equal(orderStatusLabel("SOMETHING_NEW"), "SOMETHING_NEW");
  assert.equal(orderStatusHint("SOMETHING_NEW"), "");
});

test("free orders are the ones that never went through Stripe and cost nothing", () => {
  assert.equal(isFreeOrder({ status: "CONFIRMED", total: "0.00" }), true);
  assert.equal(isFreeOrder({ status: "CONFIRMED", total: 0, stripePaymentIntentId: null, stripeCheckoutSessionId: null }), true);
  assert.equal(isFreeOrder({ status: "CONFIRMED", total: "0", stripeCheckoutSessionId: "cs_1" }), false);
  assert.equal(isFreeOrder({ status: "CONFIRMED", total: "0", stripePaymentIntentId: "pi_1" }), false);
  assert.equal(isFreeOrder({ status: "CONFIRMED", total: "42.50" }), false);
});

test("payment actions: unpaid and free orders cancel, paid orders refund what is left", () => {
  const paid = { total: "42.50", refundedAmount: "0", stripePaymentIntentId: "pi_1", stripeCheckoutSessionId: "cs_1" };
  const none = { canCancel: false, refundableAmount: null, canRestockOnRefund: false };

  assert.deepEqual(orderPaymentActions({ ...paid, status: "PENDING", stripePaymentIntentId: null }), { ...none, canCancel: true });
  for (const status of ["CONFIRMED", "PROCESSING"]) {
    assert.deepEqual(orderPaymentActions({ ...paid, status }), { canCancel: false, refundableAmount: 42.5, canRestockOnRefund: true }, status);
  }
  for (const status of ["SHIPPED", "DELIVERED"]) {
    assert.deepEqual(orderPaymentActions({ ...paid, status }), { canCancel: false, refundableAmount: 42.5, canRestockOnRefund: false }, status);
  }
  // Only what is left after a partial refund in the Stripe Dashboard.
  assert.deepEqual(
    orderPaymentActions({ ...paid, status: "PARTIALLY_REFUNDED", refundedAmount: "12.20" }),
    { canCancel: false, refundableAmount: 30.3, canRestockOnRefund: false },
  );
  for (const status of ["CANCELLED", "REFUNDED"]) {
    assert.deepEqual(orderPaymentActions({ ...paid, status }), none, status);
  }
  assert.deepEqual(orderPaymentActions({ ...paid, status: "DELIVERED", refundedAmount: "42.50" }), none);

  const free = { total: "0.00", status: "CONFIRMED" };
  assert.deepEqual(orderPaymentActions(free), { ...none, canCancel: true });
  assert.deepEqual(orderPaymentActions({ ...free, status: "PROCESSING" }), { ...none, canCancel: true });
  assert.deepEqual(orderPaymentActions({ ...free, status: "SHIPPED" }), none, "shipped free orders stay as they are");
  // A paid order without a stored payment intent cannot be refunded from the admin.
  assert.deepEqual(orderPaymentActions({ ...paid, status: "CONFIRMED", stripePaymentIntentId: null }), none);
});

test("order PATCH payload contains only changed fields", () => {
  const current = { status: "CONFIRMED", trackingNumber: "TRACK-1" };
  assert.deepEqual(buildOrderPatch(current, { status: "CONFIRMED", trackingNumber: "TRACK-1" }), { ok: false, error: "No changes to save." });
  assert.deepEqual(buildOrderPatch(current, { status: "CONFIRMED", trackingNumber: "  TRACK-1 " }), { ok: false, error: "No changes to save." });
  assert.deepEqual(buildOrderPatch(current, { status: "PROCESSING", trackingNumber: "TRACK-1" }), { ok: true, payload: { status: "PROCESSING" } });
  assert.deepEqual(buildOrderPatch(current, { status: "CONFIRMED", trackingNumber: " TRACK-2 " }), { ok: true, payload: { trackingNumber: "TRACK-2" } });
  assert.deepEqual(buildOrderPatch(current, { status: "CONFIRMED", trackingNumber: "" }), { ok: true, payload: { trackingNumber: null } });
  assert.deepEqual(buildOrderPatch(current, { status: "SHIPPED", trackingNumber: "" }), { ok: true, payload: { status: "SHIPPED", trackingNumber: null } });
  assert.deepEqual(buildOrderPatch({ status: "CONFIRMED", trackingNumber: null }, { status: "CONFIRMED", trackingNumber: "  " }), { ok: false, error: "No changes to save." });
  const tooLong = buildOrderPatch(current, { status: "CONFIRMED", trackingNumber: "x".repeat(101) });
  assert.equal(tooLong.ok, false);
});
