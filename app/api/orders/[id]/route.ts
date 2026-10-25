import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { verifyGuestOrderToken } from "@/lib/guest-order-token";
import { ORDER_STATUSES, OrderStatusValue } from "@/lib/order-lifecycle";
import {
  INTERNAL_ORDER_FIELDS,
  OrderConflictError,
  OrderInputError,
  transitionManualOrder,
  updateOrderTracking,
} from "@/lib/manual-order";
import { MAX_TRACKING_NUMBER_LENGTH } from "@/lib/admin-orders";
import { notifyLowStock, rearmLowStockAlerts } from "@/lib/inventory-alerts";
import { sendOrderStatusEmail } from "@/lib/email";
import { getStoreSettings } from "@/lib/store-settings";
import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const detailInclude = {
  user: { select: { id: true, name: true, email: true } },
  shippingAddress: true,
  billingAddress: true,
  items: { include: { product: { select: { id: true, name: true, image: true } } } },
};

// Statuses the customer is emailed about when the admin moves the order there.
const EMAILED_STATUSES: readonly string[] = ["CONFIRMED", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"];
const PAID_STATUSES: readonly string[] = ["CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "PARTIALLY_REFUNDED"];

const patchSchema = z.object({
  // Older clients always send the current status; it is treated as unchanged.
  status: z.enum(ORDER_STATUSES).optional(),
  trackingNumber: z.string().trim().max(MAX_TRACKING_NUMBER_LENGTH).nullable().optional(),
  // Refunds only: return the items to stock (allowed before shipping).
  restock: z.boolean().optional(),
});

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const isAdmin = session?.user?.role === "ADMIN";
  const order = await db.order.findUnique({
    where: { id: params.id },
    omit: { ...INTERNAL_ORDER_FIELDS, paymentConfirmedBy: !isAdmin },
    include: detailInclude,
  });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (!order.reservationExpiresAt) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  const allowed = isAdmin ||
    (!!session?.user?.id && order.userId === session.user.id) ||
    (!order.userId && verifyGuestOrderToken(request.nextUrl.searchParams.get("token"), order.id));
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(order);
}

/**
 * PATCH /api/orders/[id] (admin only)
 * Body: { status?, trackingNumber?: string | null, restock?: boolean }
 * - status moves the order (see lib/order-lifecycle.ts); the current status
 *   is ignored, so the tracking number can be edited on its own.
 * - trackingNumber "" or null clears it.
 * - restock only applies to REFUNDED before the order shipped.
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = patchSchema.parse(await request.json());
    const order = await db.order.findUnique({
      where: { id: params.id },
      select: { id: true, status: true, trackingNumber: true, reservationExpiresAt: true },
    });
    if (!order?.reservationExpiresAt) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    const nextStatus = body.status && body.status !== order.status ? body.status as OrderStatusValue : undefined;
    const tracking = body.trackingNumber === undefined ? undefined : body.trackingNumber || null;
    const trackingChanges = tracking !== undefined && tracking !== (order.trackingNumber || null);
    if (!nextStatus && !trackingChanges) {
      return NextResponse.json({ error: "No changes to save" }, { status: 400 });
    }
    if (nextStatus === "CANCELLED" && PAID_STATUSES.includes(order.status)) {
      return NextResponse.json({
        error: "This order is paid. Return the money to the customer, then mark the order as Refunded.",
      }, { status: 409 });
    }

    const updatedOrder = nextStatus
      ? await transitionManualOrder(db, {
        orderId: order.id,
        nextStatus,
        adminUserId: session.user.id,
        trackingNumber: trackingChanges ? tracking : undefined,
        recoverExpired: nextStatus === "PENDING",
        restock: body.restock,
        onStockReleased: (productIds) => rearmLowStockAlerts(db, productIds),
      })
      : await updateOrderTracking(db, { orderId: order.id, trackingNumber: tracking ?? null });
    if (!updatedOrder) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    // Notifications run after the change is committed and never undo it.
    const settings = await getStoreSettings().catch(() => null);
    const email = updatedOrder.user?.email || updatedOrder.guestEmail;
    const trackingAdded = !nextStatus && Boolean(updatedOrder.trackingNumber) && updatedOrder.status === "SHIPPED";
    if (email && ((nextStatus && EMAILED_STATUSES.includes(nextStatus)) || trackingAdded)) {
      await sendOrderStatusEmail(email, updatedOrder, settings).catch(() => {
        logger.warn("Order status email failed", { orderId: order.id });
      });
    }
    if (nextStatus === "CONFIRMED") {
      // Stock was reserved at checkout; alerts wait for a real payment so
      // abandoned orders do not use the email quota.
      await notifyLowStock(updatedOrder.items.map((item: { productId: string }) => item.productId), settings).catch(() => {
        logger.warn("Low stock check failed", { orderId: order.id });
      });
    }
    return NextResponse.json(updatedOrder);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof OrderInputError) {
      return NextResponse.json({ error: error instanceof OrderInputError ? error.message : "Invalid input" }, { status: 400 });
    }
    if (error instanceof OrderConflictError || error instanceof Error && error.message.startsWith("Invalid order transition")) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    logger.error("Order update failed", { orderId: params.id, name: error instanceof Error ? error.name : undefined });
    return NextResponse.json({ error: "Failed to update order" }, { status: 500 });
  }
}
