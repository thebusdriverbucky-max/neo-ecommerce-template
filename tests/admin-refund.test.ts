import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { moduleLoader } from "./helpers/load-module";
import { createFakeOrdersDb, cuid } from "./helpers/fake-orders-db";

process.env.STRIPE_DEPLOYMENT_ID = "store-test";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";

const ORDER_ID = cuid("order-refund");

function setup(options: {
  status?: string;
  role?: "ADMIN" | "CUSTOMER" | null;
  paymentIntentId?: string | null;
  refundedAmount?: string;
  stripeRefundedMinor?: number;
  refundStatus?: string;
  metadata?: Record<string, string>;
  createRefund?: () => never;
  retrieveFails?: boolean;
} = {}) {
  const { db, state } = createFakeOrdersDb({
    orders: [{
      id: ORDER_ID,
      status: options.status ?? "CONFIRMED",
      total: new Prisma.Decimal("42.50"),
      refundedAmount: new Prisma.Decimal(options.refundedAmount ?? "0"),
      currency: "EUR",
      guestEmail: "guest@example.com",
      stripeCheckoutSessionId: "cs_1",
      stripePaymentIntentId: options.paymentIntentId === undefined ? "pi_1" : options.paymentIntentId,
      guestAccessTokenHash: "secret-hash",
      createdAt: new Date(),
    }],
    products: [{ id: "prod1", name: "Mug", stock: 3 }],
    items: [{ id: "item1", orderId: ORDER_ID, productId: "prod1", quantity: 2, price: 21.25 }],
  });
  // Webhook event ledger: every event is new.
  db.stripeEvent = {
    createMany: async () => ({ count: 1 }),
    findUnique: async () => null,
    updateMany: async () => ({ count: 1 }),
    update: async () => ({}),
  };

  const errors: Array<[string, unknown]> = [];
  const calls = { retrieve: 0, create: [] as Array<{ params: any; requestOptions: any }> };
  const created = new Map<string, any>();
  const stripe = {
    paymentIntents: {
      retrieve: async () => {
        calls.retrieve += 1;
        if (options.retrieveFails) throw Object.assign(new Error("Invalid API Key provided"), { code: "api_key_invalid" });
        return {
          id: "pi_1",
          amount_received: 4250,
          currency: "eur",
          metadata: options.metadata ?? { orderId: ORDER_ID, deploymentId: "store-test" },
          latest_charge: { id: "ch_1", amount_refunded: options.stripeRefundedMinor ?? 0 },
        };
      },
    },
    refunds: {
      create: async (params: any, requestOptions: any) => {
        calls.create.push({ params, requestOptions });
        if (options.createRefund) options.createRefund();
        // Stripe returns the stored refund for a repeated idempotency key.
        const key = requestOptions.idempotencyKey as string;
        if (!created.has(key)) {
          created.set(key, {
            id: `re_${created.size + 1}`,
            object: "refund",
            amount: 4250 - (options.stripeRefundedMinor ?? 0),
            currency: "eur",
            status: options.refundStatus ?? "succeeded",
            created: 1_700_000_000,
            payment_intent: "pi_1",
            metadata: params.metadata,
          });
        }
        return created.get(key);
      },
    },
  };

  let webhookEvent: unknown = null;
  const load = moduleLoader({
    "@/lib/auth": {
      auth: async () => (options.role === null ? null : { user: { id: "admin-1", role: options.role ?? "ADMIN" } }),
    },
    "@/lib/db": { db },
    "@/lib/stripe": { stripe },
    "@/lib/logger": { logger: { info() {}, warn() {}, error: (message: string, meta: unknown) => { errors.push([message, meta]); } } },
    "@/lib/email": { sendOrderPlacedEmails: async () => {}, sendPaidCancelledOrderAlert: async () => {} },
    "@/lib/inventory-alerts": { notifyLowStock: async () => {}, rearmLowStockAlerts: async () => {} },
    "@/lib/stripe-webhook-signature": { constructStripeWebhookEvent: () => webhookEvent },
    "@prisma/client": { Prisma },
  });

  async function refund(body: unknown = {}) {
    const { POST } = load("app/api/orders/[id]/refund/route.ts");
    const response = await POST(
      new Request(`http://localhost/api/orders/${ORDER_ID}/refund`, { method: "POST", body: JSON.stringify(body) }),
      { params: { id: ORDER_ID } },
    );
    return { status: response.status, body: await response.json() as Record<string, any> };
  }

  async function deliverWebhook(type: string, object: unknown) {
    webhookEvent = { id: `evt_${type}_${Math.random()}`, type, data: { object } };
    const { POST } = load("app/api/stripe/webhooks/route.ts");
    const response = await POST(new Request("http://localhost/api/stripe/webhooks", {
      method: "POST", body: "{}", headers: { "stripe-signature": "sig" },
    }));
    assert.equal(response.status, 200);
  }

  const order = () => state.orders[0];
  const stock = () => state.products[0].stock;
  return { refund, deliverWebhook, load, state, calls, errors, order, stock };
}

test("only admins can refund an order", async () => {
  for (const role of [null, "CUSTOMER"] as const) {
    const { refund, calls, order } = setup({ role });
    const result = await refund({ restock: true });
    assert.equal(result.status, 401);
    assert.equal(calls.retrieve + calls.create.length, 0);
    assert.equal(order().status, "CONFIRMED");
  }
});

test("a full refund of an unshipped order returns the stock once, even after the webhook", async () => {
  const { refund, deliverWebhook, calls, order, stock, state } = setup();
  const result = await refund({ restock: true });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.refund, { id: "re_1", status: "succeeded", amountMinor: 4250, currency: "eur" });
  assert.equal(result.body.order.status, "REFUNDED");
  assert.equal("guestAccessTokenHash" in result.body.order, false, "hashes never reach the browser");
  assert.equal(order().status, "REFUNDED");
  assert.equal(Number(order().refundedAmount), 42.5);
  assert.equal(stock(), 5);

  assert.equal(calls.create.length, 1);
  assert.deepEqual(calls.create[0].params, {
    payment_intent: "pi_1",
    metadata: { orderId: ORDER_ID, deploymentId: "store-test", reason: "admin_refund", restock: "true" },
  });
  assert.equal(calls.create[0].requestOptions.idempotencyKey, `admin-refund_${ORDER_ID}_0_restock`);

  // Stripe then sends refund.created and refund.updated for the same refund.
  const sent = setupRefundObject(state);
  await deliverWebhook("refund.created", sent);
  await deliverWebhook("refund.updated", sent);
  assert.equal(stock(), 5, "the webhook does not restock a second time");
  assert.equal(order().status, "REFUNDED");
  assert.equal(state.refunds.length, 1);
});

// The refund object the webhook carries is the one the route recorded.
function setupRefundObject(state: { refunds: any[] }) {
  const row = state.refunds[0];
  return {
    id: row.stripeRefundId, object: "refund", amount: row.amountMinor, currency: "eur", status: "succeeded",
    created: 1_700_000_000, payment_intent: "pi_1", metadata: { orderId: ORDER_ID, deploymentId: "store-test", restock: "true" },
  };
}

test("a refund that keeps the stock leaves the catalog unchanged", async () => {
  const { refund, calls, order, stock } = setup({ status: "PROCESSING" });
  const result = await refund({ restock: false });
  assert.equal(result.status, 200);
  assert.equal(order().status, "REFUNDED");
  assert.equal(stock(), 3);
  assert.equal(calls.create[0].params.metadata.restock, undefined);
  assert.equal(calls.create[0].requestOptions.idempotencyKey, `admin-refund_${ORDER_ID}_0_keep-stock`);
});

test("shipped orders are refunded without restocking", async () => {
  for (const status of ["SHIPPED", "DELIVERED"]) {
    const refused = setup({ status });
    const result = await refused.refund({ restock: true });
    assert.equal(result.status, 409, status);
    assert.match(result.body.error, /before the order is shipped/);
    assert.equal(refused.calls.create.length, 0);

    const allowed = setup({ status });
    assert.equal((await allowed.refund({ restock: false })).status, 200, status);
    assert.equal(allowed.order().status, "REFUNDED");
    assert.equal(allowed.stock(), 3);
  }
});

test("orders with nothing left to refund are refused before calling Stripe", async () => {
  const cases = [
    setup({ status: "PENDING" }),
    setup({ status: "CANCELLED" }),
    setup({ status: "REFUNDED", refundedAmount: "42.50" }),
    setup({ paymentIntentId: null }),
  ];
  for (const { refund, calls, order } of cases) {
    const before = order().status;
    const result = await refund({ restock: true });
    assert.equal(result.status, 409, before);
    assert.equal(result.body.error, "This order has no Stripe payment left to refund");
    assert.equal(calls.retrieve + calls.create.length, 0);
    assert.equal(order().status, before);
  }
});

test("only what is left after a partial Dashboard refund is refunded", async () => {
  const { refund, calls, order, state } = setup({ status: "PARTIALLY_REFUNDED", refundedAmount: "12.20", stripeRefundedMinor: 1220 });
  state.refunds.push({ orderId: ORDER_ID, stripeRefundId: "re_dashboard", amount: 12.2, amountMinor: 1220, currency: "EUR", status: "succeeded" });
  const result = await refund({ restock: false });
  assert.equal(result.status, 200);
  assert.equal(result.body.refund.amountMinor, 3030);
  assert.equal(calls.create[0].requestOptions.idempotencyKey, `admin-refund_${ORDER_ID}_1220_keep-stock`);
  assert.equal(order().status, "REFUNDED");
  assert.equal(Number(order().refundedAmount), 42.5);
});

test("a payment already fully refunded in Stripe is not refunded again", async () => {
  const { refund, calls, order } = setup({ stripeRefundedMinor: 4250 });
  const result = await refund({ restock: true });
  assert.equal(result.status, 409);
  assert.match(result.body.error, /already fully refunded/);
  assert.equal(calls.create.length, 0);
  assert.equal(order().status, "CONFIRMED");
});

test("a payment that belongs to another store or order is refused", async () => {
  for (const metadata of [{ orderId: ORDER_ID, deploymentId: "another-store" }, { orderId: "another-order", deploymentId: "store-test" }]) {
    const { refund, calls, order } = setup({ metadata });
    const result = await refund({});
    assert.equal(result.status, 409);
    assert.match(result.body.error, /does not match this order/);
    assert.equal(calls.create.length, 0);
    assert.equal(order().status, "CONFIRMED");
  }
});

test("Stripe errors become clear messages and leave the order and stock alone", async () => {
  const stripeFailure = (fields: Record<string, unknown>) => () => {
    throw Object.assign(new Error("Stripe says no"), fields);
  };
  const cases: Array<[Record<string, unknown>, number, RegExp]> = [
    [{ code: "charge_already_refunded" }, 409, /already fully refunded/],
    [{ statusCode: 409, code: "idempotency_error" }, 409, /already being processed/],
    [{ code: "api_error", statusCode: 500 }, 502, /Stripe could not refund this payment: Stripe says no/],
  ];
  for (const [fields, status, message] of cases) {
    const { refund, order, stock, state } = setup({ createRefund: stripeFailure(fields) });
    const result = await refund({ restock: true });
    assert.equal(result.status, status, JSON.stringify(fields));
    assert.match(result.body.error, message);
    assert.equal(order().status, "CONFIRMED");
    assert.equal(stock(), 3);
    assert.equal(state.refunds.length, 0);
  }
});

test("a payment Stripe cannot load is reported without refunding", async () => {
  const { refund, calls, order, stock } = setup({ retrieveFails: true });
  const result = await refund({ restock: true });
  assert.equal(result.status, 502);
  assert.equal(result.body.error, "Could not load the payment from Stripe: Invalid API Key provided");
  assert.equal(calls.create.length, 0);
  assert.equal(order().status, "CONFIRMED");
  assert.equal(stock(), 3);
});

test("a pending refund is recorded now and completes the order when Stripe confirms it", async () => {
  const { refund, deliverWebhook, order, stock, state } = setup({ refundStatus: "pending" });
  const result = await refund({ restock: true });
  assert.equal(result.status, 200);
  assert.equal(result.body.refund.status, "pending");
  assert.equal(order().status, "CONFIRMED", "not refunded until Stripe confirms");
  assert.equal(stock(), 5, "items go back to stock as soon as the refund is requested");

  await deliverWebhook("refund.updated", { ...setupRefundObject(state), status: "succeeded" });
  assert.equal(order().status, "REFUNDED");
  assert.equal(stock(), 5);
  assert.equal(state.refunds[0].status, "succeeded");
});

test("a restocked refund that later fails is logged as an error", async () => {
  const { refund, deliverWebhook, order, errors, state } = setup({ refundStatus: "pending" });
  assert.equal((await refund({ restock: true })).status, 200);
  await deliverWebhook("refund.updated", { ...setupRefundObject(state), status: "failed" });
  assert.equal(order().status, "CONFIRMED");
  assert.equal(state.refunds[0].status, "failed");
  assert.ok(errors.some(([message]) => /did not go through/.test(message)), JSON.stringify(errors));
});

test("a restock refund does not restock an order that has shipped or was cancelled", async () => {
  for (const status of ["SHIPPED", "CANCELLED"]) {
    const { load, order, stock } = setup({ status });
    const { applyStripeRefund } = load("lib/refunds.ts");
    const refundObject = {
      id: "re_late", object: "refund", amount: 4250, currency: "eur", status: "succeeded", created: 1_700_000_000,
      payment_intent: "pi_1", metadata: { orderId: ORDER_ID, deploymentId: "store-test", restock: "true" },
    };
    await applyStripeRefund({ id: ORDER_ID, currency: "EUR" }, refundObject, "pi_1", 4250);
    assert.equal(stock(), 3, status);
    assert.equal(order().status, status === "SHIPPED" ? "REFUNDED" : "CANCELLED");
  }
});

test("when the order cannot be updated after the refund, the admin is told it will update by webhook", async () => {
  const { refund, order, state } = setup();
  state.refunds.push = () => { throw new Error("database down"); };
  const result = await refund({ restock: false });
  assert.equal(result.status, 500);
  assert.match(result.body.error, /refund was created in Stripe/);
  assert.equal(order().status, "CONFIRMED");
});
