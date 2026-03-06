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
}

export async function confirmOrder(orderId: string, paymentIntentId: string, storeSettings: any) {
  if (!orderId) {
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

      // If order doesn't exist or is already confirmed, do nothing.
      if (!order || order.status === "CONFIRMED") {
        return null;
      }

      // 1. Update stock for each item
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
      return tx.order.update({
        where: { id: orderId },
        data: {
          status: "CONFIRMED",
          stripePaymentIntentId: paymentIntentId,
        },
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
      const customerEmail = (updatedOrder as any).user?.email ?? (updatedOrder as any).guestEmail ?? null;

      if (customerEmail) {
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
          await sendOrderConfirmationEmail(customerEmail, orderData);
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
