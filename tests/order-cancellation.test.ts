import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { moduleLoader } from "./helpers/load-module";
import { createFakeOrdersDb, cuid } from "./helpers/fake-orders-db";

process.env.STRIPE_DEPLOYMENT_ID = "store-test";

const ORDER_ID = cuid("order-a");
const silentLogger = { info() {}, warn() {}, error() {} };

function paidSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "cs_1",
    status: "complete",
    payment_status: "paid",
    amount_total: 4250,
    currency: "eur",
    payment_intent: "pi_1",
    metadata: { orderId: ORDER_ID, deploymentId: "store-test" },
    ...overrides,
  };
}

function setup(options: {
  orderStatus?: string;
  sessionId?: string | null;
  retrieve?: () => Promise<any>;
  expire?: () => Promise<any>;
  refund?: () => Promise<any>;
} = {}) {
  const { db, state } = createFakeOrdersDb({
    orders: [{
      id: ORDER_ID,
      status: options.orderStatus ?? "PENDING",
      orderNumber: "#2026-000001",
      total: new Prisma.Decimal("42.50"),
      currency: "EUR",
      userId: null,
      guestEmail: "guest@example.com",
      stripeCheckoutSessionId: options.sessionId === undefined ? "cs_1" : options.sessionId,
      stripePaymentIntentId: null,
      checkoutIpHash: "hash",
      createdAt: new Date(),
    }],
    products: [{ id: "prod1", name: "Mug", stock: 3 }],
    items: [{ id: "item1", orderId: ORDER_ID, productId: "prod1", quantity: 2, price: 21.25 }],
  });
  const calls = { expire: 0, retrieve: 0, refund: [] as any[], placedEmails: 0, alerts: [] as any[], lowStock: 0 };
  const refunds = new Map<string, any>();
  const stripe = {
    checkout: {
      sessions: {
        retrieve: async () => {
          calls.retrieve += 1;
          return (options.retrieve ? options.retrieve() : { id: "cs_1", status: "open", payment_status: "unpaid" });
        },
        expire: async () => {
          calls.expire += 1;
          state.events.push("expire");
          return options.expire ? options.expire() : { id: "cs_1", status: "expired", payment_status: "unpaid" };
        },
      },
    },
    refunds: {
      create: async (params: any, requestOptions: any) => {
        calls.refund.push({ params, requestOptions });
        if (options.refund) return options.refund();
        // Stripe returns the stored result for a repeated idempotency key.
        const key = requestOptions.idempotencyKey as string;
        if (!refunds.has(key)) {
          refunds.set(key, { id: `re_${refunds.size + 1}`, amount: 4250, currency: "eur", status: "succeeded", created: 1_700_000_000 });
        }
        return refunds.get(key);
      },
    },
  };
  const load = moduleLoader({
    "@/lib/db": { db },
    "@/lib/stripe": { stripe },
    "@/lib/logger": { logger: silentLogger },
    "@/lib/email": {
      sendOrderPlacedEmails: async () => { calls.placedEmails += 1; },
      sendPaidCancelledOrderAlert: async (...args: unknown[]) => { calls.alerts.push(args); },
    },
    "@/lib/inventory-alerts": {
      notifyLowStock: async () => { calls.lowStock += 1; },
      rearmLowStockAlerts: async () => {},
    },
    "@prisma/client": { Prisma },
  });
  const confirmation = load("lib/order-confirmation.ts");
  return { ...confirmation, state, calls };
}

test("cancelPendingOrder expires an open session before releasing stock", async () => {
  const { cancelPendingOrder, state, calls } = setup();
  const result = await cancelPendingOrder(ORDER_ID);
  assert.deepEqual(result, { outcome: "cancelled" });
  assert.equal(calls.expire, 1);
  assert.deepEqual(state.events, ["expire", "restock:prod1"]);
  assert.equal(state.orders[0].status, "CANCELLED");
  assert.equal(state.orders[0].checkoutIpHash, null);
  assert.equal(state.products[0].stock, 5);
});

test("cancelPendingOrder confirms instead of cancelling when the session is already paid", async () => {
  const { cancelPendingOrder, state, calls } = setup({ retrieve: async () => paidSession() });
  const result = await cancelPendingOrder(ORDER_ID);
  assert.deepEqual(result, { outcome: "confirmed" });
  assert.equal(calls.expire, 0);
  assert.equal(state.orders[0].status, "CONFIRMED");
  assert.equal(state.orders[0].stripePaymentIntentId, "pi_1");
  assert.equal(state.orders[0].checkoutIpHash, null);
  assert.equal(state.products[0].stock, 3, "stock stays reserved for the paid order");
  assert.equal(calls.placedEmails, 1);
  assert.equal(calls.lowStock, 1);
});

test("cancelPendingOrder re-checks the session when expiring fails because the customer just paid", async () => {
  let retrieves = 0;
  const { cancelPendingOrder, state } = setup({
    retrieve: async () => (++retrieves === 1 ? { id: "cs_1", status: "open", payment_status: "unpaid" } : paidSession()),
    expire: async () => { throw Object.assign(new Error("not open"), { code: "resource_invalid" }); },
  });
  assert.deepEqual(await cancelPendingOrder(ORDER_ID), { outcome: "confirmed" });
  assert.equal(state.orders[0].status, "CONFIRMED");
  assert.equal(state.products[0].stock, 3);
});

test("cancelPendingOrder releases nothing when Stripe cannot be reached or the session stays payable", async () => {
  const unreachable = setup({ retrieve: async () => { throw new Error("network"); } });
  const first = await unreachable.cancelPendingOrder(ORDER_ID);
  assert.equal(first.outcome, "error");
  assert.equal(unreachable.state.orders[0].status, "PENDING");
  assert.equal(unreachable.state.products[0].stock, 3);

  const stuck = setup({ expire: async () => { throw new Error("cannot expire"); } });
  const second = await stuck.cancelPendingOrder(ORDER_ID);
  assert.equal(second.outcome, "error");
  assert.equal(stuck.state.orders[0].status, "PENDING");
  assert.equal(stuck.state.products[0].stock, 3);
  assert.deepEqual(stuck.state.events, ["expire"]);
});

test("cancelPendingOrder cancels directly without a session and ignores non-pending orders", async () => {
  const withoutSession = setup({ sessionId: null });
  assert.deepEqual(await withoutSession.cancelPendingOrder(ORDER_ID), { outcome: "cancelled" });
  assert.equal(withoutSession.calls.retrieve, 0);
  assert.equal(withoutSession.state.products[0].stock, 5);

  const confirmed = setup({ orderStatus: "CONFIRMED" });
  assert.deepEqual(await confirmed.cancelPendingOrder(ORDER_ID), { outcome: "unchanged" });
  assert.equal(confirmed.state.products[0].stock, 3);
});

test("a payment for a cancelled order is refunded once and the admin is alerted once", async () => {
  const { confirmOrder, state, calls } = setup({ orderStatus: "CANCELLED" });

  // checkout.session.completed and payment_intent.succeeded both arrive.
  const first = await confirmOrder(ORDER_ID, { paymentIntentId: "pi_1", checkoutSessionId: "cs_1" }, null);
  const second = await confirmOrder(ORDER_ID, { paymentIntentId: "pi_1" }, null);

  assert.equal(first, "refunded");
  assert.equal(second, "refunded");
  assert.equal(state.orders[0].status, "CANCELLED");
  assert.equal(state.orders[0].stripePaymentIntentId, "pi_1", "linked so refund events find the order");
  assert.equal(calls.placedEmails, 0);
  assert.equal(calls.refund.length, 2);
  for (const call of calls.refund) {
    assert.equal(call.params.payment_intent, "pi_1");
    assert.deepEqual(call.params.metadata, {
      orderId: ORDER_ID,
      deploymentId: "store-test",
      reason: "order_cancelled_before_payment",
    });
    assert.equal(call.requestOptions.idempotencyKey, `cancelled-order-refund_${ORDER_ID}_pi_1`);
  }
  assert.equal(state.refunds.length, 1);
  assert.equal(state.refunds[0].amountMinor, 4250);
  assert.equal(calls.alerts.length, 1);
  assert.deepEqual(calls.alerts[0][1], { paymentIntentId: "pi_1", refundId: "re_1" });
  assert.equal(state.products[0].stock, 3, "stock is not reserved again");
});

test("a failed automatic refund alerts with the error and rethrows so Stripe retries", async () => {
  const { confirmOrder, state, calls } = setup({
    orderStatus: "CANCELLED",
    refund: async () => { throw Object.assign(new Error("Stripe is down"), { code: "api_error" }); },
  });
  await assert.rejects(confirmOrder(ORDER_ID, { paymentIntentId: "pi_1", checkoutSessionId: "cs_1" }, null), /Stripe is down/);
  assert.equal(state.orders[0].status, "CANCELLED");
  assert.equal(state.refunds.length, 0);
  assert.equal(calls.alerts.length, 1);
  assert.equal(calls.alerts[0][1].refundError, "Stripe is down");
  assert.equal(calls.alerts[0][1].refundId, null);
});

test("a paid pending order is confirmed normally and never refunded", async () => {
  const { confirmOrder, state, calls } = setup();
  assert.equal(await confirmOrder(ORDER_ID, { paymentIntentId: "pi_1", checkoutSessionId: "cs_1" }, null), "confirmed");
  assert.equal(await confirmOrder(ORDER_ID, { paymentIntentId: "pi_1" }, null), "unchanged");
  assert.equal(state.orders[0].status, "CONFIRMED");
  assert.equal(calls.refund.length, 0);
  assert.equal(calls.placedEmails, 1, "duplicate events send one email");
});

test("refund events for an automatically refunded cancelled order do not throw and keep it cancelled", async () => {
  const { db, state } = createFakeOrdersDb({
    orders: [{
      id: ORDER_ID, status: "CANCELLED", total: new Prisma.Decimal("42.50"), currency: "EUR",
      stripePaymentIntentId: "pi_1", stripeCheckoutSessionId: "cs_1", refundedAmount: 0,
    }],
  });
  const events: Array<{ id: string; status: string }> = [];
  const db2 = {
    ...db,
    stripeEvent: {
      createMany: async ({ data }: any) => { events.push({ id: data[0].eventId, status: "PROCESSING" }); return { count: 1 }; },
      findUnique: async () => null,
      updateMany: async () => ({ count: 1 }),
      update: async () => ({}),
    },
    stripeRefund: {
      ...db.stripeRefund,
      aggregate: async () => ({ _sum: { amount: new Prisma.Decimal("42.50"), amountMinor: 4250 } }),
    },
  };
  const refund = { id: "re_1", object: "refund", amount: 4250, currency: "eur", status: "succeeded", created: 1_700_000_000, payment_intent: "pi_1" };
  const stripe = {
    paymentIntents: {
      retrieve: async () => ({ id: "pi_1", amount_received: 4250, currency: "eur", metadata: { orderId: ORDER_ID, deploymentId: "store-test" } }),
    },
  };
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  const load = moduleLoader({
    "@/lib/db": { db: db2 },
    "@/lib/stripe": { stripe },
    "@/lib/logger": { logger: silentLogger },
    "@/lib/email": {},
    "@/lib/inventory-alerts": {},
    "@/lib/stripe-webhook-signature": { constructStripeWebhookEvent: () => ({ id: "evt_1", type: "refund.created", data: { object: refund } }) },
    "@prisma/client": { Prisma },
  });
  const { POST } = load("app/api/stripe/webhooks/route.ts");
  const response = await POST(new Request("http://localhost/api/stripe/webhooks", {
    method: "POST", body: "{}", headers: { "stripe-signature": "sig" },
  }));
  assert.equal(response.status, 200);
  assert.equal(state.orders[0].status, "CANCELLED");
});
