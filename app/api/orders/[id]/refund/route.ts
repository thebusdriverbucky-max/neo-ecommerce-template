import type Stripe from "stripe";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { logger } from "@/lib/logger";
import { orderPaymentActions } from "@/lib/admin-orders";
import { applyStripeRefund, RESTOCK_REFUND_METADATA } from "@/lib/refunds";
import {
  assertPaymentIntentMatchesOrder,
  getStripeDeploymentId,
  StripePaymentIntegrityError,
} from "@/lib/stripe-payment-integrity";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

function stripeError(error: unknown): { code?: string; statusCode?: number; message?: string } {
  if (typeof error !== "object" || error === null) return {};
  const { code, statusCode, message } = error as { code?: unknown; statusCode?: unknown; message?: unknown };
  return {
    code: typeof code === "string" ? code : undefined,
    statusCode: typeof statusCode === "number" ? statusCode : undefined,
    message: typeof message === "string" ? message : undefined,
  };
}

/**
 * POST /api/orders/[id]/refund (admins only)
 * Body: { restock?: boolean }
 *
 * Refunds what is left of the order's payment through Stripe and updates the
 * order right away; the refund webhook later applies the same refund again
 * without effect. `restock` returns the items to stock and is accepted only
 * while the order has not been shipped. Partial refunds stay in the Stripe
 * Dashboard. Errors are always { error: string }.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user?.id || session.user.role !== "ADMIN") {
      return fail(401, "Unauthorized");
    }

    const body = await request.json().catch(() => ({}));
    const restock = Boolean(body && typeof body === "object" && (body as { restock?: unknown }).restock === true);

    const order = await db.order.findUnique({ where: { id: params.id } });
    if (!order) {
      return fail(404, "Order not found");
    }

    const actions = orderPaymentActions(order);
    if (actions.refundableAmount === null || !order.stripePaymentIntentId) {
      return fail(409, "This order has no Stripe payment left to refund");
    }
    if (restock && !actions.canRestockOnRefund) {
      return fail(409, "Items can be returned to stock only before the order is shipped");
    }

    let paymentIntent: Stripe.PaymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.retrieve(order.stripePaymentIntentId, {
        expand: ["latest_charge"],
      });
    } catch (error) {
      const { code, message } = stripeError(error);
      logger.error("Could not load the payment for a refund", { orderId: order.id, code });
      return fail(502, `Could not load the payment from Stripe${message ? `: ${message}` : ""}`);
    }
    assertPaymentIntentMatchesOrder(paymentIntent, order);
    const charge = typeof paymentIntent.latest_charge === "object" ? paymentIntent.latest_charge : null;
    const alreadyRefundedMinor = charge?.amount_refunded ?? 0;
    if (alreadyRefundedMinor >= paymentIntent.amount_received) {
      return fail(409, "This payment is already fully refunded in Stripe; the order updates when Stripe's webhook arrives");
    }

    let refund: Stripe.Refund;
    try {
      refund = await stripe.refunds.create(
        {
          payment_intent: paymentIntent.id,
          metadata: {
            orderId: order.id,
            deploymentId: getStripeDeploymentId(),
            reason: "admin_refund",
            ...(restock ? { [RESTOCK_REFUND_METADATA]: "true" } : {}),
          },
        },
        // A double click or a retry reuses the refund instead of creating a second one.
        { idempotencyKey: `admin-refund_${order.id}_${alreadyRefundedMinor}_${restock ? "restock" : "keep-stock"}` },
      );
    } catch (error) {
      const { code, statusCode, message } = stripeError(error);
      if (code === "charge_already_refunded") {
        return fail(409, "This payment is already fully refunded in Stripe");
      }
      if (statusCode === 409) {
        return fail(409, "A refund for this order is already being processed. Refresh in a moment.");
      }
      logger.error("Admin refund failed", { orderId: order.id, code });
      return fail(502, `Stripe could not refund this payment${message ? `: ${message}` : ""}`);
    }

    try {
      await applyStripeRefund(order, refund, paymentIntent.id, paymentIntent.amount_received);
    } catch {
      // The money is already on its way back; the webhook retries the update.
      logger.error("Refund created but the order could not be updated", { orderId: order.id, refundId: refund.id });
      return fail(500, "The refund was created in Stripe, but the order could not be updated. It updates automatically when Stripe's webhook arrives.");
    }

    const updatedOrder = await db.order.findUnique({
      where: { id: order.id },
      omit: { guestAccessTokenHash: true, checkoutIpHash: true },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    return NextResponse.json({
      order: updatedOrder,
      refund: { id: refund.id, status: refund.status, amountMinor: refund.amount, currency: refund.currency },
    });
  } catch (error) {
    if (error instanceof StripePaymentIntegrityError) {
      return fail(409, "The Stripe payment does not match this order. Refund it from the Stripe Dashboard.");
    }
    logger.error("Order refund failed", {
      orderId: params.id,
      name: error instanceof Error ? error.name : undefined,
    });
    return fail(500, "Failed to refund the order");
  }
}
