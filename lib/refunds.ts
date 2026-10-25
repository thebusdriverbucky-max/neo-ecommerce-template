import type { OrderStatus } from "@prisma/client";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { fromMinorUnits, normalizeCurrency } from "@/lib/money";
import { restockOrderItems } from "@/lib/order-confirmation";

/** Refund metadata set by the admin refund action to return items to stock. */
export const RESTOCK_REFUND_METADATA = "restock";

type RefundedOrder = { id: string; currency: string };

const RESTOCKABLE_STATUSES: OrderStatus[] = ["CONFIRMED", "PROCESSING"];

/**
 * Records a Stripe refund on its order and moves the order to
 * PARTIALLY_REFUNDED or REFUNDED from the total of succeeded refunds.
 *
 * Both the refund webhook and the admin refund action call this for the same
 * refund. The unique stripeRefundId makes the first caller the only one that
 * inserts the row, so a restock requested by the admin happens exactly once.
 */
export async function applyStripeRefund(
  order: RefundedOrder,
  refund: Stripe.Refund,
  paymentIntentId: string,
  paidAmountMinor: number,
): Promise<void> {
  const currency = normalizeCurrency(refund.currency);
  if (currency !== normalizeCurrency(order.currency)) {
    throw new Error("Refund currency does not match order currency");
  }
  const refundAmount = fromMinorUnits(refund.amount, currency);
  const incomingStatus = refund.status || "pending";
  const restockRequested = refund.metadata?.[RESTOCK_REFUND_METADATA] === "true";

  await db.$transaction(async (tx) => {
    const recorded = await tx.stripeRefund.createMany({
      data: [{
        orderId: order.id,
        stripeRefundId: refund.id,
        paymentIntentId,
        amount: refundAmount,
        amountMinor: refund.amount,
        currency,
        status: incomingStatus,
        stripeCreatedAt: new Date(refund.created * 1000),
      }],
      skipDuplicates: true,
    });
    if (recorded.count !== 1 || !restockRequested || incomingStatus === "failed" || incomingStatus === "canceled") {
      return;
    }
    // Only unshipped orders get their items back; a cancelled order's stock
    // was already returned when it was cancelled.
    const current = await tx.order.findUnique({ where: { id: order.id }, select: { status: true } });
    if (current && RESTOCKABLE_STATUSES.includes(current.status)) {
      await restockOrderItems(tx, order.id);
    }
  });

  const updated = await db.stripeRefund.updateMany({
    where: {
      stripeRefundId: refund.id,
      status: { notIn: ["succeeded", "failed", "canceled"] },
    },
    data: {
      amount: refundAmount,
      amountMinor: refund.amount,
      currency,
      status: incomingStatus,
      stripeCreatedAt: new Date(refund.created * 1000),
    },
  });
  if (updated.count > 0 && restockRequested && (incomingStatus === "failed" || incomingStatus === "canceled")) {
    logger.error("A refund that returned items to stock did not go through; check the order and the stock", {
      orderId: order.id,
      refundId: refund.id,
    });
  }

  const successfulRefunds = await db.stripeRefund.aggregate({
    where: { orderId: order.id, status: "succeeded" },
    _sum: { amount: true, amountMinor: true },
  });
  if (!successfulRefunds._sum.amountMinor) return;

  const refundedAmountMinor = successfulRefunds._sum.amountMinor || 0;
  if (refundedAmountMinor > paidAmountMinor) {
    throw new Error("Cumulative refunds exceed the paid amount");
  }

  await db.order.updateMany({
    where: {
      id: order.id,
      status: refundedAmountMinor >= paidAmountMinor
        ? { in: ["CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "PARTIALLY_REFUNDED", "REFUNDED"] }
        : { in: ["CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "PARTIALLY_REFUNDED"] },
      refundedAmount: { lte: successfulRefunds._sum.amount || 0 },
    },
    data: {
      refundedAmount: successfulRefunds._sum.amount || 0,
      status: refundedAmountMinor >= paidAmountMinor ? "REFUNDED" : "PARTIALLY_REFUNDED",
    },
  });
}
