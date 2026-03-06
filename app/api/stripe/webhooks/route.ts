// File: app/api/stripe/webhooks/route.ts

import { db } from "@/lib/db";
import { sendOrderConfirmationEmail, sendNewOrderNotificationEmail } from "@/lib/email";

export const dynamic = 'force-dynamic';

export async function POST() {
  return new Response("Stripe webhooks are disabled in LITE version", { status: 404 });
}

async function confirmOrder(orderId: string, paymentIntentId: string | null, storeSettings: any) {
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
