import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { fromMinorUnits, normalizeCurrency } from "@/lib/money";
import { logger } from "@/lib/logger";
import {
  confirmOrder,
  handleOrderCancellation,
} from "@/lib/order-confirmation";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

function getWebhookSecret(): string {
  return process.env.STRIPE_WEBHOOK_SECRET || "";
}

async function findOrderForPaymentIntent(paymentIntentId: string, orderId?: string | null) {
  if (orderId) {
    const byMetadata = await db.order.findUnique({ where: { id: orderId } });
    if (byMetadata) return byMetadata;
  }
  return db.order.findUnique({ where: { stripePaymentIntentId: paymentIntentId } });
}

async function resolvePaymentIntentId(refund: Stripe.Refund): Promise<string | null> {
  if (typeof refund.payment_intent === "string") return refund.payment_intent;
  if (refund.payment_intent?.id) return refund.payment_intent.id;
  if (!refund.charge) return null;

  const chargeId = typeof refund.charge === "string" ? refund.charge : refund.charge.id;
  const charge = await stripe.charges.retrieve(chargeId);
  return typeof charge.payment_intent === "string"
    ? charge.payment_intent
    : charge.payment_intent?.id || null;
}

async function processRefund(refund: Stripe.Refund) {
  const paymentIntentId = await resolvePaymentIntentId(refund);
  if (!paymentIntentId) return;

  const order = await db.order.findUnique({ where: { stripePaymentIntentId: paymentIntentId } });
  if (!order) return;

  const currency = normalizeCurrency(refund.currency);
  const refundAmount = fromMinorUnits(refund.amount, currency);
  await db.stripeRefund.upsert({
    where: { stripeRefundId: refund.id },
    create: {
      orderId: order.id,
      stripeRefundId: refund.id,
      paymentIntentId,
      amount: refundAmount,
      amountMinor: refund.amount,
      currency,
      status: refund.status || "pending",
      stripeCreatedAt: new Date(refund.created * 1000),
    },
    update: {
      amount: refundAmount,
      amountMinor: refund.amount,
      currency,
      status: refund.status || "pending",
      stripeCreatedAt: new Date(refund.created * 1000),
    },
  });

  const successfulRefunds = await db.stripeRefund.aggregate({
    where: { orderId: order.id, status: "succeeded" },
    _sum: { amount: true, amountMinor: true },
  });
  if (!successfulRefunds._sum.amountMinor) return;

  const refundedAmountMinor = successfulRefunds._sum.amountMinor || 0;
  const paidAmountMinor = await stripe.paymentIntents.retrieve(paymentIntentId).then((intent) => intent.amount_received);

  await db.order.update({
    where: { id: order.id },
    data: {
      refundedAmount: successfulRefunds._sum.amount || 0,
      status: refundedAmountMinor >= paidAmountMinor ? "REFUNDED" : "PARTIALLY_REFUNDED",
    },
  });
}

async function processEvent(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const checkoutSession = event.data.object as Stripe.Checkout.Session;
      if (checkoutSession.payment_status !== "paid") return;

      const paymentIntentId = typeof checkoutSession.payment_intent === "string"
        ? checkoutSession.payment_intent
        : null;
      const order = checkoutSession.metadata?.orderId
        ? await db.order.findUnique({ where: { id: checkoutSession.metadata.orderId } })
        : paymentIntentId
          ? await findOrderForPaymentIntent(paymentIntentId)
          : await db.order.findUnique({ where: { stripeCheckoutSessionId: checkoutSession.id } });

      if (!order) return;
      const settings = await db.storeSettings.findFirst();
      await confirmOrder(order.id, {
        paymentIntentId,
        checkoutSessionId: checkoutSession.id,
      }, settings);
      return;
    }

    case "payment_intent.succeeded": {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const order = await findOrderForPaymentIntent(paymentIntent.id, paymentIntent.metadata.orderId);
      if (!order) return;

      const settings = await db.storeSettings.findFirst();
      await confirmOrder(order.id, { paymentIntentId: paymentIntent.id }, settings);
      return;
    }

    case "payment_intent.payment_failed": {
      // A failed attempt does not necessarily end Checkout. The customer can
      // retry the same Session, so release stock only on session.expired.
      logger.warn("Stripe payment attempt failed", {
        paymentIntentId: (event.data.object as Stripe.PaymentIntent).id,
      });
      return;
    }

    case "checkout.session.expired": {
      const checkoutSession = event.data.object as Stripe.Checkout.Session;
      if (checkoutSession.metadata?.orderId) {
        await handleOrderCancellation(checkoutSession.metadata.orderId);
      } else {
        const order = await db.order.findUnique({ where: { stripeCheckoutSessionId: checkoutSession.id } });
        if (order) await handleOrderCancellation(order.id);
      }
      return;
    }

    case "refund.created":
    case "refund.updated":
      await processRefund(event.data.object as Stripe.Refund);
      return;
  }
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature") || "";
  const webhookSecret = getWebhookSecret();

  if (!webhookSecret) {
    logger.error("Stripe webhook secret is not configured");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch {
    logger.warn("Stripe webhook signature verification failed");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    const claim = await db.stripeEvent.createMany({
      data: [{ eventId: event.id, type: event.type, status: "PROCESSING" }],
      skipDuplicates: true,
    });

    if (claim.count === 0) {
      const previous = await db.stripeEvent.findUnique({ where: { eventId: event.id } });
      if (previous?.status === "PROCESSED") {
        return NextResponse.json({ received: true, duplicate: true });
      }

      // A fresh PROCESSING claim belongs to another invocation. FAILED claims
      // are deliberately retryable so Stripe receives 500 until processing is
      // durable; stale PROCESSING claims are also recoverable after a crash.
      if (
        previous?.status === "PROCESSING" &&
        previous.updatedAt > new Date(Date.now() - 5 * 60 * 1000)
      ) {
        return NextResponse.json({ received: true, duplicate: true });
      }

      const reclaimed = await db.stripeEvent.updateMany({
        where: {
          eventId: event.id,
          OR: [
            { status: "FAILED" },
            { status: "PROCESSING", updatedAt: { lt: new Date(Date.now() - 5 * 60 * 1000) } },
          ],
        },
        data: { status: "PROCESSING", error: null },
      });
      if (reclaimed.count !== 1) {
        return NextResponse.json({ received: true, duplicate: true });
      }
    }

    await processEvent(event);
    await db.stripeEvent.update({
      where: { eventId: event.id },
      data: { status: "PROCESSED", processedAt: new Date(), error: null },
    });

    return NextResponse.json({ received: true });
  } catch (error: any) {
    await db.stripeEvent.updateMany({
      where: { eventId: event.id },
      data: {
        status: "FAILED",
        error: String(error?.message || "Webhook processing failed").slice(0, 1000),
      },
    });
    logger.error("Stripe webhook processing failed", { eventId: event.id, eventType: event.type, code: error?.code });
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
