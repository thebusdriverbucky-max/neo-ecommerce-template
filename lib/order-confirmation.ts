// File: lib/order-confirmation.ts
//
// Order confirmation / cancellation logic shared by the Stripe webhook
// and the order success page. Kept in `lib/` because Next.js route files
// must only export HTTP handlers.

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import {
  sendOrderConfirmationEmail,
  sendNewOrderNotificationEmail,
} from "@/lib/email";

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

export async function handleOrderCancellation(orderId: string) {
  if (!orderId) return;

  await db.$transaction(async (tx) => {
    // Claim the state transition atomically. Stripe retries events and doesn't
    // guarantee their order, so only one worker is allowed to restock.
    const cancelled = await tx.order.updateMany({
      where: { id: orderId, status: "PENDING" },
      data: { status: "CANCELLED" },
    });

    if (cancelled.count === 0) return;

    const items = await tx.orderItem.findMany({ where: { orderId } });

    // Return stock (stock was reserved at order creation)
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
  });
}

export async function confirmOrder(
  orderId: string,
  paymentIntentId: string,
  storeSettings: any
) {
  if (!orderId) {
    return;
  }

  // Use a transaction to ensure atomicity
  try {
    const updatedOrder = (await db.$transaction(async (tx) => {
      // Atomically claim PENDING -> CONFIRMED. Both checkout.session.completed
      // and payment_intent.succeeded may arrive concurrently.
      const confirmed = await tx.order.updateMany({
        where: { id: orderId, status: "PENDING" },
        data: {
          status: "CONFIRMED",
          stripePaymentIntentId: paymentIntentId,
        },
      });

      if (confirmed.count === 0) {
        return null;
      }

      // NOTE: stock was already decremented (reserved) when the order was
      // created in POST /api/orders. Do NOT decrement it again here,
      // otherwise every paid order removes stock twice.

      return tx.order.findUnique({
        where: { id: orderId },
        include: {
          user: true,
          items: {
            include: { product: true },
          },
          shippingAddress: true,
        },
      });
    })) as UpdatedOrder | null;

    if (updatedOrder) {
      const customerEmail =
        updatedOrder.user?.email ?? updatedOrder.guestEmail ?? null;

      if (customerEmail) {
        const orderData = {
          orderNumber:
            updatedOrder.orderNumber ||
            `ORD-${updatedOrder.id.slice(0, 8).toUpperCase()}`,
          orderId: updatedOrder.id,
          total: Number(updatedOrder.total),
          subtotal: Number(updatedOrder.subtotal),
          tax: Number(updatedOrder.tax),
          shippingCost: Number(updatedOrder.shippingCost),
          storeName:
            storeSettings?.storeName ||
            process.env.NEXT_PUBLIC_STORE_NAME ||
            "Store",
          items: updatedOrder.items.map((item) => ({
            name: item.product.name,
            qty: item.quantity,
            price: Number(item.price),
          })),
        };

        try {
          await sendOrderConfirmationEmail(customerEmail, orderData);
        } catch (emailError) {
          console.error(
            `Failed to send confirmation email for order ${orderId}:`,
            emailError
          );
        }
      }

      const adminEmail = storeSettings?.storeEmail || process.env.ADMIN_EMAIL;
      if (adminEmail) {
        try {
          await sendNewOrderNotificationEmail(
            updatedOrder,
            {
              ...storeSettings,
              storeEmail: adminEmail,
            }
          );
        } catch (emailError) {
          console.error(
            `Failed to send new order notification for order ${orderId}:`,
            emailError
          );
        }
      }
    }
  } catch (error) {
    console.error(`❌ Error in confirmOrder for order ${orderId}:`, error);
    throw error;
  }
}
