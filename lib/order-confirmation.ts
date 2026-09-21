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
import { createGuestOrderToken } from "@/lib/guest-order-token";
import { logger } from "@/lib/logger";

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

export async function handleOrderCancellation(orderId: string): Promise<boolean> {
  if (!orderId) return false;

  return db.$transaction(async (tx) => {
    // Claim the state transition atomically. Stripe retries events and doesn't
    // guarantee their order, so only one worker is allowed to restock.
    const cancelled = await tx.order.updateMany({
      where: { id: orderId, status: "PENDING" },
      data: { status: "CANCELLED" },
    });

    if (cancelled.count === 0) return false;

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

    return true;
  });
}

export async function confirmOrder(
  orderId: string,
  identifiers: {
    paymentIntentId?: string | null;
    checkoutSessionId?: string | null;
  },
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
        }
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
          guestAccessToken:
            updatedOrder.guestAccessTokenExpiresAt && !updatedOrder.userId
              ? createGuestOrderToken(updatedOrder.id, updatedOrder.guestAccessTokenExpiresAt)
              : undefined,
        };

        try {
          await sendOrderConfirmationEmail(customerEmail, orderData);
        } catch (emailError) {
          logger.error("Failed to send confirmation email", { orderId });
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
          logger.error("Failed to send new order notification", { orderId });
        }
      }
    }
  } catch (error) {
    logger.error("Order confirmation failed", { orderId });
    throw error;
  }
}
