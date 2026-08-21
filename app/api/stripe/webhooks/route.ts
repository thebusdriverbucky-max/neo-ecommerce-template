// File: app/api/stripe/webhooks/route.ts

import { stripe } from "@/lib/stripe";
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import {
  confirmOrder,
  handleOrderCancellation,
} from "@/lib/order-confirmation";

export const dynamic = 'force-dynamic';

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature") || "";

  if (!webhookSecret) {
    return NextResponse.json(
      { error: "Webhook not configured" },
      { status: 500 }
    );
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (error) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orderId = session.metadata?.orderId;
        const paymentIntentId = session.payment_intent as string;
        const sessionId = session.id;

        if (orderId) {
          const settings = await db.storeSettings.findFirst();
          await confirmOrder(orderId, paymentIntentId || sessionId, settings);
        } else {
          const order = await db.order.findFirst({
            where: {
              OR: [
                sessionId ? { stripePaymentIntentId: sessionId } : null,
                paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : null
              ].filter((item): item is { stripePaymentIntentId: string } => item !== null)
            }
          });

          if (order) {
            const settings = await db.storeSettings.findFirst();
            await confirmOrder(order.id, paymentIntentId || sessionId, settings);
          }
        }
        break;
      }
      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const orderId = paymentIntent.metadata.orderId;

        if (orderId) {
          const settings = await db.storeSettings.findFirst();
          await confirmOrder(orderId, paymentIntent.id, settings);
        } else {
          // Try to find order by stripePaymentIntentId if not in metadata
          const order = await db.order.findFirst({
            where: { stripePaymentIntentId: paymentIntent.id }
          });
          if (order) {
            const settings = await db.storeSettings.findFirst();
            await confirmOrder(order.id, paymentIntent.id, settings);
          }
        }
        break;
      }
      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await handleOrderCancellation(paymentIntent.metadata.orderId);
        break;
      }
      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orderId = session.metadata?.orderId;
        if (orderId) {
          await handleOrderCancellation(orderId);
        }
        break;
      }
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        if (charge.payment_intent) {
          const order = await db.order.findFirst({
            where: { stripePaymentIntentId: charge.payment_intent as string },
          });

          if (order) {
            await db.order.update({
              where: { id: order.id },
              data: { status: "REFUNDED" },
            });
          }
        }
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Webhook processing error:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
