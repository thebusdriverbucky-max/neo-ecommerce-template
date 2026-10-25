import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { moduleLoader } from "./helpers/load-module";
import { createFakeOrdersDb, cuid } from "./helpers/fake-orders-db";

process.env.STRIPE_DEPLOYMENT_ID = "store-test";

const ORDER_ID = cuid("order-patch");
const OWNER_ID = cuid("owner");
const silentLogger = { info() {}, warn() {}, error() {} };

function setup(options: {
  status?: string;
  trackingNumber?: string | null;
  role?: "ADMIN" | "CUSTOMER";
  userId?: string;
  sessionId?: string | null;
  paymentIntentId?: string | null;
  total?: string;
  retrieve?: () => any;
  emailFails?: boolean;
} = {}) {
  const { db, state } = createFakeOrdersDb({
    orders: [{
      id: ORDER_ID,
      userId: OWNER_ID,
      guestEmail: null,
      status: options.status ?? "CONFIRMED",
      trackingNumber: options.trackingNumber ?? null,
      total: new Prisma.Decimal(options.total ?? "42.50"),
      currency: "EUR",
      stripeCheckoutSessionId: options.sessionId ?? null,
      stripePaymentIntentId: options.paymentIntentId ?? null,
      createdAt: new Date(),
    }],
    users: [{ id: OWNER_ID, email: "owner@example.com" }],
    products: [{ id: "prod1", name: "Mug", stock: 3 }],
    items: [{ id: "item1", orderId: ORDER_ID, productId: "prod1", quantity: 1, price: 42.5 }],
    settings: { storeName: "Shop" },
  });
  const emails: Array<{ to: string; order: any }> = [];
  const stripe = {
    checkout: {
      sessions: {
        retrieve: async () => options.retrieve?.() ?? { id: "cs_1", status: "open", payment_status: "unpaid" },
        expire: async () => ({ id: "cs_1", status: "expired", payment_status: "unpaid" }),
      },
    },
  };
  const load = moduleLoader({
    "@/lib/auth": { auth: async () => ({ user: { id: options.userId ?? OWNER_ID, role: options.role ?? "ADMIN" } }) },
    "@/lib/db": { db },
    "@/lib/stripe": { stripe },
    "@/lib/logger": { logger: silentLogger },
    "@/lib/email": {
      sendOrderStatusEmail: async (to: string, order: any) => {
        emails.push({ to, order });
        if (options.emailFails) throw new Error("mail down");
      },
      sendOrderPlacedEmails: async () => {},
      sendPaidCancelledOrderAlert: async () => {},
    },
    "@/lib/inventory-alerts": { notifyLowStock: async () => {}, rearmLowStockAlerts: async () => {} },
    "@prisma/client": { Prisma },
  });
  const { PATCH } = load("app/api/orders/[id]/route.ts");
  async function patch(body: unknown) {
    const response = await PATCH(
      new Request(`http://localhost/api/orders/${ORDER_ID}`, { method: "PATCH", body: typeof body === "string" ? body : JSON.stringify(body) }),
      { params: { id: ORDER_ID } },
    );
    return { status: response.status, body: await response.json() as Record<string, any> };
  }
  return { patch, state, emails };
}

test("admin can update only the tracking number, trimmed, without a status change", async () => {
  const { patch, state, emails } = setup({ status: "PROCESSING" });
  const result = await patch({ trackingNumber: "  1Z999  " });
  assert.equal(result.status, 200);
  assert.equal(result.body.trackingNumber, "1Z999");
  assert.equal(result.body.status, "PROCESSING");
  assert.equal(result.body.user.email, "owner@example.com");
  assert.equal(state.orders[0].trackingNumber, "1Z999");
  assert.equal(emails.length, 0, "no email until the order is shipped");
});

test("an empty string or null clears the tracking number; omitted leaves it unchanged", async () => {
  for (const cleared of ["", "   ", null]) {
    const { patch, state } = setup({ status: "PROCESSING", trackingNumber: "ABC" });
    const result = await patch({ trackingNumber: cleared });
    assert.equal(result.status, 200, `value ${JSON.stringify(cleared)}`);
    assert.equal(state.orders[0].trackingNumber, null);
  }
  const { patch, state } = setup({ status: "PROCESSING", trackingNumber: "ABC" });
  const result = await patch({ status: "SHIPPED" });
  assert.equal(result.status, 200);
  assert.equal(state.orders[0].trackingNumber, "ABC");
});

test("a status equal to the current one is a no-op and no effective change is a 400", async () => {
  const { patch, emails } = setup({ status: "SHIPPED", trackingNumber: "ABC" });
  assert.deepEqual(await patch({ status: "SHIPPED" }), { status: 400, body: { error: "No changes to save" } });
  assert.deepEqual(await patch({}), { status: 400, body: { error: "No changes to save" } });
  assert.deepEqual(await patch({ status: "SHIPPED", trackingNumber: "ABC" }), { status: 400, body: { error: "No changes to save" } });
  assert.equal(emails.length, 0);

  // Same status plus a real tracking change succeeds and ignores the status.
  const updated = await patch({ status: "SHIPPED", trackingNumber: "NEW" });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.trackingNumber, "NEW");
});

test("legacy clients sending a current status outside the allowed targets are not rejected", async () => {
  // The previous admin UI always sent the current status (e.g. CONFIRMED).
  const { patch } = setup({ status: "CONFIRMED" });
  assert.deepEqual(await patch({ status: "CONFIRMED" }), { status: 400, body: { error: "No changes to save" } });
  const updated = await patch({ status: "CONFIRMED", trackingNumber: "TRK-1" });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.trackingNumber, "TRK-1");
  assert.equal(updated.body.status, "CONFIRMED");
});

test("status changes are validated and errors are always { error }", async () => {
  const { patch } = setup({ status: "CONFIRMED" });
  for (const body of [{ status: "BOGUS" }, { status: 5 }, { trackingNumber: 12 }, { trackingNumber: "x".repeat(101) }, [], "not json"]) {
    const result = await patch(body);
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.equal(typeof result.body.error, "string");
  }
  const backwards = setup({ status: "SHIPPED" });
  const invalidTransition = await backwards.patch({ status: "PROCESSING" });
  assert.equal(invalidTransition.status, 409);
  assert.match(invalidTransition.body.error, /Cannot transition/);
  assert.equal(backwards.state.orders[0].status, "SHIPPED");
});

test("optional fulfilment steps can be skipped", async () => {
  for (const [from, to] of [["CONFIRMED", "SHIPPED"], ["CONFIRMED", "DELIVERED"], ["PROCESSING", "DELIVERED"], ["PARTIALLY_REFUNDED", "SHIPPED"]]) {
    const { patch, state } = setup({ status: from });
    const result = await patch({ status: to });
    assert.equal(result.status, 200, `${from} -> ${to}`);
    assert.equal(state.orders[0].status, to);
  }
});

test("cancelling a paid order is refused and points to the refund", async () => {
  for (const status of ["CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "PARTIALLY_REFUNDED"]) {
    const { patch, state } = setup({ status, sessionId: "cs_1", paymentIntentId: "pi_1" });
    const result = await patch({ status: "CANCELLED" });
    assert.equal(result.status, 409);
    assert.equal(result.body.error, "Paid orders are cancelled by refunding the payment; the order status then updates automatically.");
    assert.equal(state.orders[0].status, status);
    assert.equal(state.products[0].stock, 3);
  }
});

test("an admin can cancel a free order before it ships, which returns the stock", async () => {
  for (const status of ["CONFIRMED", "PROCESSING"]) {
    const { patch, state } = setup({ status, total: "0" });
    const result = await patch({ status: "CANCELLED", trackingNumber: "" });
    assert.equal(result.status, 200, status);
    assert.equal(result.body.status, "CANCELLED");
    assert.equal(state.orders[0].status, "CANCELLED");
    assert.equal(state.products[0].stock, 4);
  }

  // Shipped free orders, customers, and orders that went through Stripe are refused.
  const shipped = setup({ status: "SHIPPED", total: "0" });
  assert.equal((await shipped.patch({ status: "CANCELLED" })).status, 409);
  const customer = setup({ role: "CUSTOMER", status: "CONFIRMED", total: "0" });
  assert.equal((await customer.patch({ status: "CANCELLED" })).status, 409);
  const discountedToZeroViaStripe = setup({ status: "CONFIRMED", total: "0", sessionId: "cs_1" });
  assert.equal((await discountedToZeroViaStripe.patch({ status: "CANCELLED" })).status, 409);
  for (const refused of [shipped, customer, discountedToZeroViaStripe]) {
    assert.notEqual(refused.state.orders[0].status, "CANCELLED");
    assert.equal(refused.state.products[0].stock, 3);
  }
});

test("order responses never include checkout or guest-access hashes", async () => {
  const { patch } = setup({ status: "PROCESSING" });
  const result = await patch({ status: "SHIPPED" });
  assert.equal(result.status, 200);
  assert.equal("guestAccessTokenHash" in result.body, false);
  assert.equal("checkoutIpHash" in result.body, false);
});

test("cancelling a pending order releases stock; a payment that landed first confirms it instead", async () => {
  const pending = setup({ status: "PENDING", sessionId: "cs_1" });
  const cancelled = await pending.patch({ status: "CANCELLED" });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.status, "CANCELLED");
  assert.equal(pending.state.products[0].stock, 4);

  const paid = setup({
    status: "PENDING",
    sessionId: "cs_1",
    retrieve: () => ({
      id: "cs_1", status: "complete", payment_status: "paid", amount_total: 4250, currency: "eur", payment_intent: "pi_1",
      metadata: { orderId: ORDER_ID, deploymentId: "store-test" },
    }),
  });
  const result = await paid.patch({ status: "CANCELLED" });
  assert.equal(result.status, 409);
  assert.match(result.body.error, /paid/i);
  assert.equal(paid.state.orders[0].status, "CONFIRMED");
  assert.equal(paid.state.products[0].stock, 3);

  const stripeDown = setup({ status: "PENDING", sessionId: "cs_1", retrieve: () => { throw new Error("network"); } });
  const failed = await stripeDown.patch({ status: "CANCELLED" });
  assert.equal(failed.status, 502);
  assert.equal(stripeDown.state.orders[0].status, "PENDING");
  assert.equal(stripeDown.state.products[0].stock, 3);
});

test("non-admin owners can only cancel their own pending order", async () => {
  const cancel = setup({ role: "CUSTOMER", status: "PENDING" });
  assert.equal((await cancel.patch({ status: "CANCELLED" })).status, 200);

  const ship = setup({ role: "CUSTOMER", status: "PROCESSING" });
  const shipped = await ship.patch({ status: "SHIPPED" });
  assert.equal(shipped.status, 403);
  assert.equal(ship.state.orders[0].status, "PROCESSING");

  const tracking = setup({ role: "CUSTOMER", status: "PENDING" });
  assert.equal((await tracking.patch({ trackingNumber: "ABC" })).status, 403);
  assert.equal(tracking.state.orders[0].trackingNumber, null);

  const paidCancel = setup({ role: "CUSTOMER", status: "CONFIRMED" });
  assert.equal((await paidCancel.patch({ status: "CANCELLED" })).status, 409);

  const stranger = setup({ role: "CUSTOMER", status: "PENDING", userId: cuid("stranger") });
  assert.equal((await stranger.patch({ status: "CANCELLED" })).status, 403);
});

test("status emails: shipped, delivered, and a tracking change on a shipped order; failures never fail the update", async () => {
  const shipped = setup({ status: "PROCESSING" });
  const result = await shipped.patch({ status: "SHIPPED", trackingNumber: "TRACK1" });
  assert.equal(result.status, 200);
  assert.equal(shipped.emails.length, 1, "one email for status + tracking in the same request");
  assert.equal(shipped.emails[0].to, "owner@example.com");
  assert.equal(shipped.emails[0].order.trackingNumber, "TRACK1");

  const retracked = setup({ status: "SHIPPED", trackingNumber: "OLD" });
  assert.equal((await retracked.patch({ trackingNumber: "NEW" })).status, 200);
  assert.equal(retracked.emails.length, 1);
  const cleared = setup({ status: "SHIPPED", trackingNumber: "OLD" });
  await cleared.patch({ trackingNumber: null });
  assert.equal(cleared.emails.length, 0, "clearing sends nothing");

  const delivered = setup({ status: "SHIPPED" });
  await delivered.patch({ status: "DELIVERED" });
  assert.equal(delivered.emails.length, 1);

  const broken = setup({ status: "PROCESSING", emailFails: true });
  const survived = await broken.patch({ status: "SHIPPED" });
  assert.equal(survived.status, 200);
  assert.equal(broken.state.orders[0].status, "SHIPPED");
});
