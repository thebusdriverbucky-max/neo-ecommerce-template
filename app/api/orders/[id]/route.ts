import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { canTransitionOrder } from "@/lib/order-state";
import { cancelFreeOrder, cancelPendingOrder } from "@/lib/order-confirmation";
import { isFreeOrder } from "@/lib/admin-orders";
import { getStoreSettings } from "@/lib/store-settings";
import { sendOrderStatusEmail } from "@/lib/email";
import type { OrderStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_STATUSES: OrderStatus[] = ["PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"];
const MAX_TRACKING_NUMBER_LENGTH = 100;

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

/**
 * PATCH /api/orders/[id]
 * Body: { status?: PROCESSING | SHIPPED | DELIVERED | CANCELLED, trackingNumber?: string | null }
 * - Admins may change the status and/or the tracking number ("" or null clears it).
 * - Owners may only cancel their own PENDING order. Admins may also cancel a
 *   free (never charged) order before it ships; paid orders are refunded instead.
 * - A status equal to the current one is ignored; no effective change is a 400.
 * - Errors are always { error: string }.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return fail(401, "Unauthorized");
    }

    const order = await db.order.findUnique({
      where: { id: params.id },
    });

    if (!order) {
      return fail(404, "Order not found");
    }

    // Only admin or order owner can update
    const isAdmin = session.user.role === "ADMIN";
    if (!isAdmin && order.userId !== session.user.id) {
      return fail(403, "Forbidden");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail(400, "Invalid order update");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return fail(400, "Invalid order update");
    }

    const { status, trackingNumber } = body as {
      status?: unknown;
      trackingNumber?: unknown;
    };

    let requestedStatus: OrderStatus | undefined;
    // Older clients always send the current status along with other edits;
    // treat it as "unchanged" before validating the allowed targets.
    if (status !== undefined && status !== null && status !== "" && status !== order.status) {
      if (typeof status !== "string" || !ALLOWED_STATUSES.includes(status as OrderStatus)) {
        return fail(400, `Invalid status. Allowed: ${ALLOWED_STATUSES.join(", ")}`);
      }
      requestedStatus = status as OrderStatus;
    }

    // undefined: leave unchanged; null: clear
    let requestedTracking: string | null | undefined;
    if (trackingNumber !== undefined) {
      if (!isAdmin) {
        return fail(403, "Only administrators can update tracking information");
      }
      if (trackingNumber === null) {
        requestedTracking = null;
      } else if (typeof trackingNumber === "string") {
        const trimmed = trackingNumber.trim();
        if (trimmed.length > MAX_TRACKING_NUMBER_LENGTH) {
          return fail(400, `Tracking number must be at most ${MAX_TRACKING_NUMBER_LENGTH} characters`);
        }
        requestedTracking = trimmed || null;
      } else {
        return fail(400, "Invalid trackingNumber");
      }
    }

    const statusChanges = requestedStatus !== undefined && requestedStatus !== order.status;
    const trackingChanges = requestedTracking !== undefined && requestedTracking !== (order.trackingNumber || null);

    if (!statusChanges && !trackingChanges) {
      return fail(400, "No changes to save");
    }

    // A free order (100% discount) has no payment to refund, so an admin may
    // cancel it before it ships.
    const cancelsFreeOrder = isAdmin && isFreeOrder(order) && canTransitionOrder(order.status, "CANCELLED", true);

    if (statusChanges && requestedStatus === "CANCELLED") {
      // Paid orders are cancelled by refunding them (POST /api/orders/[id]/refund
      // or the Stripe Dashboard); the refund then updates the order status.
      if (order.status !== "PENDING" && !cancelsFreeOrder) {
        return fail(409, "Paid orders are cancelled by refunding the payment; the order status then updates automatically.");
      }
    } else if (statusChanges && requestedStatus) {
      if (!isAdmin) {
        return fail(403, "Only administrators can change the order status");
      }
      if (!canTransitionOrder(order.status, requestedStatus, isAdmin)) {
        return fail(409, `Cannot transition order from ${order.status} to ${requestedStatus}`);
      }
    }

    if (statusChanges && requestedStatus === "CANCELLED" && order.status !== "PENDING") {
      if (!(await cancelFreeOrder(order.id))) {
        return fail(409, "Order was changed by another request");
      }
      if (trackingChanges) {
        await db.order.updateMany({ where: { id: order.id }, data: { trackingNumber: requestedTracking } });
      }
    } else if (statusChanges && requestedStatus === "CANCELLED") {
      // Expires the Stripe session before releasing stock; a payment that
      // landed in the meantime confirms the order instead of being lost.
      const cancellation = await cancelPendingOrder(order.id);
      if (cancellation.outcome === "confirmed") {
        return fail(409, "This order was paid just now, so it was not cancelled. It is now confirmed; use Refund if you still want to cancel it.");
      }
      if (cancellation.outcome === "unchanged") {
        return fail(409, "Order was changed by another request");
      }
      if (cancellation.outcome === "error") {
        return fail(502, "Could not cancel the payment session with Stripe. Please try again in a moment.");
      }
      if (trackingChanges) {
        await db.order.updateMany({ where: { id: order.id }, data: { trackingNumber: requestedTracking } });
      }
    } else {
      const updated = await db.order.updateMany({
        where: {
          id: order.id,
          ...(statusChanges ? { status: order.status } : {}),
        },
        data: {
          ...(statusChanges && requestedStatus ? { status: requestedStatus } : {}),
          ...(trackingChanges ? { trackingNumber: requestedTracking } : {}),
        },
      });
      if (updated.count !== 1) {
        return fail(409, "Order was changed by another request");
      }
    }

    // Never serialize password hashes or reset tokens to the browser.
    const updatedOrder = await db.order.findUnique({
      where: { id: order.id },
      omit: { guestAccessTokenHash: true, checkoutIpHash: true },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    if (!updatedOrder) {
      return fail(404, "Order not found after update");
    }

    // Customer email: shipped/delivered, or a new tracking number on a shipped order.
    const email = updatedOrder.user?.email || updatedOrder.guestEmail;
    const becameShippedOrDelivered = statusChanges
      && (updatedOrder.status === "SHIPPED" || updatedOrder.status === "DELIVERED");
    const trackingAdded = trackingChanges && Boolean(updatedOrder.trackingNumber) && updatedOrder.status === "SHIPPED";
    if (email && (becameShippedOrDelivered || trackingAdded)) {
      try {
        await sendOrderStatusEmail(email, updatedOrder, await getStoreSettings());
      } catch {
        logger.error("Failed to send order status email", { orderId: order.id });
      }
    }

    return NextResponse.json(updatedOrder);
  } catch (error) {
    logger.error("Order update failed", {
      orderId: params.id,
      name: error instanceof Error ? error.name : undefined,
    });
    return fail(500, "Failed to update order");
  }
}
