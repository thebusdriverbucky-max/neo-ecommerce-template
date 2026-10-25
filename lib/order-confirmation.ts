// File: lib/order-confirmation.ts
//
// Order confirmation / cancellation logic shared by the Stripe webhook
// and the order success page. Kept in `lib/` because Next.js route files
// must only export HTTP handlers.

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import type { StoreSettings } from "@prisma/client";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { sendOrderPlacedEmails, sendPaidCancelledOrderAlert } from "@/lib/email";
import { notifyLowStock, rearmLowStockAlerts } from "@/lib/inventory-alerts";
import { logger } from "@/lib/logger";
import { fromMinorUnits, normalizeCurrency } from "@/lib/money";
import { getStoreSettings } from "@/lib/store-settings";
import {
  assertCheckoutSessionMatchesOrder,
  assertStripeIdentifiersOwnedByOrder,
  getStripeDeploymentId,
} from "@/lib/stripe-payment-integrity";

type UpdatedOrder = Prisma.OrderGetPayload<{
  include: {
    user: true;
    items: {
      include: {
        product: true;
      };
    };
    shippingAddress: true;
  };
}>;

export type ConfirmOrderResult =
  /** This call claimed PENDING -> CONFIRMED. */
  | "confirmed"
  /** The order was already confirmed (or is in a later paid state). */
  | "unchanged"
  /** The order was cancelled before the payment arrived; the payment was refunded. */
  | "refunded";

export type CancelPendingOrderResult =
  | { outcome: "cancelled" | "confirmed" | "unchanged" }
  | { outcome: "error"; message: string };

type StockClient = Pick<Prisma.TransactionClient, "orderItem" | "product" | "inventoryAlert">;

/**
 * Returns an order's items to stock (stock is reserved at order creation).
 * Callers must first claim a once-only change, such as a status transition,
 * in the same transaction so retries never restock twice.
 */
export async function restockOrderItems(tx: StockClient, orderId: string): Promise<void> {
  const items = await tx.orderItem.findMany({ where: { orderId } });

  for (const item of items) {
    await tx.product.update({
      where: { id: item.productId },
      data: {
        stock: {
          increment: item.quantity,
        },
      },
    });
  }

  // Products that are back above their threshold may alert again.
  await rearmLowStockAlerts(tx, items.map((item) => item.productId));
}

export async function handleOrderCancellation(orderId: string): Promise<boolean> {
  if (!orderId) return false;

  return db.$transaction(async (tx) => {
    // Claim the state transition atomically. Stripe retries events and doesn't
    // guarantee their order, so only one worker is allowed to restock.
    // The IP hash only exists to cap unpaid reservations, so it is dropped as
    // soon as the order stops being PENDING.
    const cancelled = await tx.order.updateMany({
      where: { id: orderId, status: "PENDING" },
      data: { status: "CANCELLED", checkoutIpHash: null },
    });

    if (cancelled.count === 0) return false;

    await restockOrderItems(tx, orderId);
    return true;
  });
}

/**
 * Cancels a confirmed order that never went through Stripe (a 100% discount)
 * and returns its stock. Orders with a payment are refunded instead.
 */
export async function cancelFreeOrder(orderId: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const cancelled = await tx.order.updateMany({
      where: {
        id: orderId,
        status: { in: ["CONFIRMED", "PROCESSING"] },
        stripePaymentIntentId: null,
        stripeCheckoutSessionId: null,
        total: 0,
      },
      data: { status: "CANCELLED" },
    });
    if (cancelled.count === 0) return false;

    await restockOrderItems(tx, orderId);
    return true;
  });
}

function stripeErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Cancels an unpaid (PENDING) order without losing a payment that is in
 * flight. When the order has a Checkout Session, the session is expired at
 * Stripe BEFORE stock is released, so the customer can no longer pay for a
 * reservation that was given back. If Stripe reports the session as paid (or
 * it completes while we try to expire it) the order is confirmed instead.
 *
 * Any Stripe API error leaves the order untouched (stock stays reserved) and
 * is reported as `{ outcome: "error" }`; the reconciliation job resolves it.
 */
export async function cancelPendingOrder(
  orderId: string,
  settings?: StoreSettings | null,
): Promise<CancelPendingOrderResult> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      total: true,
      currency: true,
      stripeCheckoutSessionId: true,
      stripePaymentIntentId: true,
    },
  });
  if (!order || order.status !== "PENDING") return { outcome: "unchanged" };

  const sessionId = order.stripeCheckoutSessionId;
  if (!sessionId) {
    return { outcome: (await handleOrderCancellation(order.id)) ? "cancelled" : "unchanged" };
  }

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.status === "open" && session.payment_status !== "paid") {
      try {
        session = await stripe.checkout.sessions.expire(sessionId);
      } catch (expireError) {
        // Expiring fails when the session is no longer open, typically because
        // the customer just paid. Look at the session again to decide.
        logger.warn("Checkout Session could not be expired; re-checking it", {
          orderId,
          code: stripeErrorCode(expireError),
        });
        session = await stripe.checkout.sessions.retrieve(sessionId);
      }
    }
  } catch (error) {
    logger.error("Could not reach Stripe to cancel a pending order", {
      orderId,
      code: stripeErrorCode(error),
    });
    return { outcome: "error", message: "Could not cancel the payment session with Stripe" };
  }

  if (session.payment_status === "paid") {
    try {
      assertCheckoutSessionMatchesOrder(session, order);
      const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : null;
      const result = await confirmOrder(
        order.id,
        { paymentIntentId, checkoutSessionId: session.id },
        settings === undefined ? await getStoreSettings() : settings,
      );
      return { outcome: result === "refunded" ? "unchanged" : "confirmed" };
    } catch (error) {
      logger.error("Could not confirm a paid order while cancelling it", {
        orderId,
        code: stripeErrorCode(error),
      });
      return { outcome: "error", message: "The order was paid and could not be cancelled" };
    }
  }

  if (session.status === "expired") {
    return { outcome: (await handleOrderCancellation(order.id)) ? "cancelled" : "unchanged" };
  }

  // Still open or completing: never release stock for a payable session.
  logger.error("Checkout Session is still payable; order not cancelled", { orderId, status: session.status });
  return { outcome: "error", message: "The payment session is still active" };
}

type CancelledOrderInfo = {
  id: string;
  orderNumber: string | null;
  total: Prisma.Decimal;
  currency: string;
  stripePaymentIntentId: string | null;
};

async function alertPaidCancelledOrder(
  order: CancelledOrderInfo,
  details: { paymentIntentId: string | null; refundId: string | null; refundError?: string },
  storeSettings: StoreSettings | null,
) {
  try {
    await sendPaidCancelledOrderAlert(order, details, storeSettings);
  } catch {
    logger.error("Failed to send paid-cancelled order alert", { orderId: order.id });
  }
}

/**
 * A payment arrived for an order that was already cancelled (stock released).
 * The order stays CANCELLED and the payment is refunded automatically. Both
 * checkout.session.completed and payment_intent.succeeded land here; the
 * Stripe idempotency key keeps the refund single and the StripeRefund insert
 * gates the admin alert so only one email goes out.
 */
async function refundPaymentForCancelledOrder(
  order: CancelledOrderInfo,
  paymentIntentId: string | null,
  storeSettings: StoreSettings | null,
) {
  if (!paymentIntentId) {
    logger.error("Payment received for a cancelled order without a PaymentIntent; refund it manually", {
      orderId: order.id,
    });
    await alertPaidCancelledOrder(
      order,
      { paymentIntentId: null, refundId: null, refundError: "The payment has no PaymentIntent id; refund it in the Stripe Dashboard." },
      storeSettings,
    );
    return;
  }

  let refund: Stripe.Refund;
  try {
    refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        metadata: {
          orderId: order.id,
          deploymentId: getStripeDeploymentId(),
          reason: "order_cancelled_before_payment",
        },
      },
      { idempotencyKey: `cancelled-order-refund_${order.id}_${paymentIntentId}` },
    );
  } catch (error) {
    if (stripeErrorCode(error) === "charge_already_refunded") {
      logger.warn("Payment for a cancelled order was already refunded", { orderId: order.id, paymentIntentId });
      return;
    }
    logger.error("Automatic refund of a payment for a cancelled order failed", {
      orderId: order.id,
      paymentIntentId,
      code: stripeErrorCode(error),
    });
    await alertPaidCancelledOrder(
      order,
      {
        paymentIntentId,
        refundId: null,
        refundError: error instanceof Error ? error.message : "Refund request failed",
      },
      storeSettings,
    );
    // Let Stripe retry the webhook; the idempotency key keeps the refund single.
    throw error;
  }

  const currency = normalizeCurrency(refund.currency || order.currency);
  const recorded = await db.stripeRefund.createMany({
    data: [{
      orderId: order.id,
      stripeRefundId: refund.id,
      paymentIntentId,
      amount: fromMinorUnits(refund.amount, currency),
      amountMinor: refund.amount,
      currency,
      status: refund.status || "pending",
      stripeCreatedAt: refund.created ? new Date(refund.created * 1000) : null,
    }],
    skipDuplicates: true,
  });

  // Link the PaymentIntent so later refund.updated events find the order.
  // The status stays CANCELLED.
  if (!order.stripePaymentIntentId) {
    await db.order.updateMany({
      where: { id: order.id, status: "CANCELLED", stripePaymentIntentId: null },
      data: { stripePaymentIntentId: paymentIntentId },
    });
  }

  if (recorded.count !== 1) return;

  logger.error("Payment received for a cancelled order and refunded automatically", {
    orderId: order.id,
    paymentIntentId,
    refundId: refund.id,
  });
  await alertPaidCancelledOrder(order, { paymentIntentId, refundId: refund.id }, storeSettings);
}

export async function confirmOrder(
  orderId: string,
  identifiers: {
    paymentIntentId?: string | null;
    checkoutSessionId?: string | null;
  },
  storeSettings: StoreSettings | null
): Promise<ConfirmOrderResult> {
  if (!orderId) {
    return "unchanged";
  }

  // Use a transaction to ensure atomicity
  try {
    const outcome = await db.$transaction(async (tx) => {
      const currentOrder = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          stripeCheckoutSessionId: true,
          stripePaymentIntentId: true,
        },
      });
      if (!currentOrder) return { kind: "unchanged" } as const;
      assertStripeIdentifiersOwnedByOrder(currentOrder, identifiers);

      const ownershipConditions: Prisma.OrderWhereInput[] = [
        ...(identifiers.checkoutSessionId
          ? [{
              OR: [
                { stripeCheckoutSessionId: null },
                { stripeCheckoutSessionId: identifiers.checkoutSessionId },
              ],
            }]
          : []),
        ...(identifiers.paymentIntentId
          ? [{
              OR: [
                { stripePaymentIntentId: null },
                { stripePaymentIntentId: identifiers.paymentIntentId },
              ],
            }]
          : []),
      ];

      // Atomically claim PENDING -> CONFIRMED. Both checkout.session.completed
      // and payment_intent.succeeded may arrive concurrently.
      const confirmed = await tx.order.updateMany({
        where: {
          id: orderId,
          status: "PENDING",
          AND: ownershipConditions,
        },
        data: {
          status: "CONFIRMED",
          // The reservation is now a paid order; stop counting it per client.
          checkoutIpHash: null,
          ...(identifiers.paymentIntentId
            ? { stripePaymentIntentId: identifiers.paymentIntentId }
            : {}),
          ...(identifiers.checkoutSessionId
            ? { stripeCheckoutSessionId: identifiers.checkoutSessionId }
            : {}),
        },
      });

      if (confirmed.count === 0) {
        // A duplicate or out-of-order event may arrive after the order was
        // already confirmed. Retain any identifier that was not available on
        // the first event without sending another email.
        if (identifiers.paymentIntentId || identifiers.checkoutSessionId) {
          await tx.order.updateMany({
            where: {
              id: orderId,
              AND: ownershipConditions,
              status: {
                in: [
                  "CONFIRMED",
                  "PROCESSING",
                  "SHIPPED",
                  "DELIVERED",
                  "PARTIALLY_REFUNDED",
                  "REFUNDED",
                ],
              },
            },
            data: {
              ...(identifiers.paymentIntentId
                ? { stripePaymentIntentId: identifiers.paymentIntentId }
                : {}),
              ...(identifiers.checkoutSessionId
                ? { stripeCheckoutSessionId: identifiers.checkoutSessionId }
                : {}),
            },
          });

          const retainedOrder = await tx.order.findUnique({
            where: { id: orderId },
            select: {
              id: true,
              status: true,
              orderNumber: true,
              total: true,
              currency: true,
              stripeCheckoutSessionId: true,
              stripePaymentIntentId: true,
            },
          });
          if (retainedOrder) {
            assertStripeIdentifiersOwnedByOrder(retainedOrder, identifiers);
            // The payment arrived after the order was cancelled and its stock
            // released. Callers have already matched the payment to this order.
            if (retainedOrder.status === "CANCELLED") {
              return { kind: "cancelled", order: retainedOrder } as const;
            }
          }
        }
        return { kind: "unchanged" } as const;
      }

      // NOTE: stock was already decremented (reserved) when the order was
      // created in POST /api/orders. Do NOT decrement it again here,
      // otherwise every paid order removes stock twice.

      const order = (await tx.order.findUnique({
        where: { id: orderId },
        include: {
          user: true,
          items: {
            include: { product: true },
          },
          shippingAddress: true,
        },
      })) as UpdatedOrder | null;
      return order ? ({ kind: "confirmed", order } as const) : ({ kind: "unchanged" } as const);
    });

    if (outcome.kind === "cancelled") {
      await refundPaymentForCancelledOrder(outcome.order, identifiers.paymentIntentId ?? null, storeSettings);
      return "refunded";
    }

    if (outcome.kind === "unchanged") return "unchanged";

    const updatedOrder = outcome.order;
    try {
      await sendOrderPlacedEmails(updatedOrder, storeSettings);
    } catch {
      logger.error("Failed to send order emails", { orderId });
    }

    try {
      await notifyLowStock(updatedOrder.items.map((item) => item.productId), storeSettings);
    } catch {
      logger.error("Low stock notification failed", { orderId });
    }
    return "confirmed";
  } catch (error) {
    logger.error("Order confirmation failed", { orderId });
    throw error;
  }
}
