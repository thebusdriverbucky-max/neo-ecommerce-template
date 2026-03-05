// File: app/api/stripe/webhooks/route.ts

import { stripe } from "@/lib/stripe";
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { sendOrderConfirmationEmail, sendNewOrderNotificationEmail } from "@/lib/email";

export const dynamic = 'force-dynamic';

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";

async function handleOrderCancellation(orderId: string) {
  if (!orderId) return;

  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });

  if (!order || order.status === "CANCELLED") return;

  await db.$transaction(async (tx) => {
    // Update order status
    await tx.order.update({
      where: { id: orderId },
      data: { status: "CANCELLED" },
    });

    // Return stock
    for (const item of order.items) {
      await tx.product.update({
        where: { id: item.productId },
        data: {
          stock: {
            increment: item.quantity,
          },
        },
      });
    }
  });

  console.log(`Order ${orderId} cancelled and stock returned`);
}

export async function confirmOrder(orderId: string, paymentIntentId: string, storeSettings: any) {
  console.log(`🔄 Confirming order: ${orderId}, paymentIntent: ${paymentIntentId}`);
  if (!orderId) {
    console.error("❌ No orderId provided to confirmOrder");
    return;
  }

  // Use a transaction to ensure atomicity
  try {
    const updatedOrder = await db.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: true,
        },
      });

      console.log(`🔍 Order found in DB:`, order ? { id: order.id, status: order.status } : "NOT FOUND");

      // If order doesn't exist or is already confirmed, do nothing.
      if (!order || order.status === "CONFIRMED") {
        console.log(`Order ${orderId} already confirmed or not found, skipping.`);
        return null;
      }

      // 1. Update stock for each item
      console.log(`📉 Updating stock for ${order.items.length} items`);
      for (const item of order.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: {
            stock: {
              decrement: item.quantity,
            },
          },
        });
      }

      // 2. Update order status to CONFIRMED
      console.log(`✅ Updating order status to CONFIRMED`);
      return tx.order.update({
        where: { id: orderId },
        data: {
          status: "CONFIRMED",
          stripePaymentIntentId: paymentIntentId,
        } as any,
        include: {
          user: true,
          items: {
            include: { product: true },
          },
          shippingAddress: true,
        },
      });
    });

    if (updatedOrder) {
      console.log(`🎉 Order ${orderId} successfully confirmed in DB`);
      const customerEmail = (updatedOrder as any).user?.email ?? (updatedOrder as any).guestEmail ?? null;

      if (customerEmail) {
        console.log(`📧 Sending confirmation to: ${customerEmail}`);
        const orderData = {
          orderNumber: (updatedOrder as any).orderNumber || `ORD-${updatedOrder.id.slice(0, 8).toUpperCase()}`,
          orderId: updatedOrder.id,
          total: Number(updatedOrder.total),
          subtotal: Number(updatedOrder.subtotal),
          tax: Number(updatedOrder.tax),
          shippingCost: Number(updatedOrder.shippingCost),
          storeName: storeSettings?.storeName || process.env.NEXT_PUBLIC_STORE_NAME || 'Store',
          items: (updatedOrder as any).items.map((item: any) => ({
            name: item.product.name,
            qty: item.quantity,
            price: Number(item.price),
          })),
        };

        try {
          const result = await sendOrderConfirmationEmail(customerEmail, orderData);
          console.log(`📧 Confirmation result:`, result);
        } catch (emailError) {
          console.error(`Failed to send confirmation email for order ${orderId}:`, emailError);
        }
      }

      const adminEmail = storeSettings?.storeEmail || process.env.ADMIN_EMAIL;
      if (adminEmail) {
        try {
          await sendNewOrderNotificationEmail(updatedOrder as any, {
            ...storeSettings,
            storeEmail: adminEmail
          });
        } catch (emailError) {
          console.error(`Failed to send new order notification for order ${orderId}:`, emailError);
        }
      }
      console.log(`Order ${orderId} confirmed with payment ${paymentIntentId}`);
    }
  } catch (error) {
    console.error(`❌ Error in confirmOrder for order ${orderId}:`, error);
    throw error;
  }
}

async function handlePaymentIntentFailed(
  paymentIntent: Stripe.PaymentIntent
) {
  const orderId = paymentIntent.metadata.orderId;
  await handleOrderCancellation(orderId);
}

export async function POST(request: NextRequest) {
  console.log("Webhook received", {
    url: request.url,
    headers: Object.fromEntries(request.headers.entries()),
  });
  const body = await request.text();
  console.log("RAW BODY RECEIVED, length:", body.length);
  const signature = request.headers.get("stripe-signature") || "";

  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET not configured");
    return NextResponse.json(
      { error: "Webhook not configured" },
      { status: 500 }
    );
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    console.log("WEBHOOK RECEIVED", { type: event.type, id: event.id });
  } catch (error) {
    console.error("Webhook signature verification failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orderId = session.metadata?.orderId;
        const paymentIntentId = session.payment_intent as string;
        const sessionId = session.id;

        console.log("🔔 Webhook: checkout.session.completed", {
          orderId,
          paymentIntentId,
          sessionId,
          metadata: session.metadata
        });

        if (orderId) {
          const settings = await db.storeSettings.findFirst();
          await confirmOrder(orderId, paymentIntentId || sessionId, settings);
        } else {
          console.warn("⚠️ No orderId in session metadata, trying to find by sessionId or paymentIntentId");
          const order = await db.order.findFirst({
            where: {
              OR: [
                { stripePaymentIntentId: sessionId },
                { stripePaymentIntentId: paymentIntentId }
              ].filter(Boolean) as any[]
            }
          });

          if (order) {
            console.log(`✅ Found order ${order.id} by Stripe ID`);
            const settings = await db.storeSettings.findFirst();
            await confirmOrder(order.id, paymentIntentId || sessionId, settings);
          } else {
            console.error("❌ Could not find order for checkout.session.completed");
          }
        }
        break;
      }
      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const orderId = paymentIntent.metadata.orderId;

        console.log("🔔 Webhook: payment_intent.succeeded", {
          orderId,
          paymentIntentId: paymentIntent.id,
          metadata: paymentIntent.metadata
        });

        if (orderId) {
          const settings = await db.storeSettings.findFirst();
          await confirmOrder(orderId, paymentIntent.id, settings);
        } else {
          console.warn("⚠️ No orderId in payment_intent metadata, trying to find by paymentIntentId");
          // Try to find order by stripePaymentIntentId if not in metadata
          const order = await db.order.findFirst({
            where: { stripePaymentIntentId: paymentIntent.id } as any
          });
          if (order) {
            console.log(`✅ Found order ${order.id} by paymentIntentId`);
            const settings = await db.storeSettings.findFirst();
            await confirmOrder(order.id, paymentIntent.id, settings);
          } else {
            console.error("❌ Could not find order for payment_intent.succeeded");
          }
        }
        break;
      }
      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await handlePaymentIntentFailed(paymentIntent);
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
            where: { stripePaymentIntentId: charge.payment_intent as string } as any,
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
