import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { canTransitionOrder } from "@/lib/order-state";
import { handleOrderCancellation } from "@/lib/order-confirmation";
import { OrderStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { sendOrderStatusUpdateEmail } from "@/lib/email";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const order = await db.order.findUnique({
      where: { id: params.id },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Only admin or order owner can update
    const isAdmin = session.user.role === "ADMIN";
    if (!isAdmin && order.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid order update" }, { status: 400 });
    }

    const { status, trackingNumber } = body as {
      status?: unknown;
      trackingNumber?: unknown;
    };

    if (trackingNumber !== undefined && !isAdmin) {
      return NextResponse.json({ error: "Only administrators can update tracking information" }, { status: 403 });
    }

    let requestedStatus: OrderStatus | undefined;
    if (status) {
      const allowedStatuses: OrderStatus[] = ["CANCELLED", "PROCESSING", "SHIPPED", "DELIVERED"];
      if (typeof status !== "string" || !allowedStatuses.includes(status as OrderStatus)) {
        return NextResponse.json(
          { error: `Invalid status. Allowed: ${allowedStatuses.join(", ")}` },
          { status: 400 }
        );
      }
      requestedStatus = status as OrderStatus;
      if (!canTransitionOrder(order.status, requestedStatus, isAdmin)) {
        return NextResponse.json({ error: `Cannot transition order from ${order.status} to ${requestedStatus}` }, { status: 409 });
      }
    }

    if (trackingNumber !== undefined) {
      if (typeof trackingNumber !== "string" || trackingNumber.length > 100) {
        return NextResponse.json({ error: "Invalid trackingNumber" }, { status: 400 });
      }
    }

    if (!requestedStatus && trackingNumber === undefined) {
      return NextResponse.json({ error: "No supported order changes provided" }, { status: 400 });
    }

    let updatedOrder;
    if (requestedStatus === "CANCELLED") {
      // Paid orders require an explicit refund workflow. This endpoint only
      // releases stock for an unpaid PENDING checkout, and the helper claims
      // the transition atomically so concurrent cancellation/webhook requests
      // cannot restock twice.
      if (order.status !== "PENDING") {
        return NextResponse.json(
          { error: "Only pending orders can be cancelled here; paid orders require a refund workflow" },
          { status: 409 }
        );
      }
      const cancelled = await handleOrderCancellation(order.id);
      if (!cancelled) {
        return NextResponse.json({ error: "Order was changed by another request" }, { status: 409 });
      }
      updatedOrder = await db.order.findUnique({
        where: { id: order.id },
        include: { user: true },
      });
    } else {
      const updateData: { status?: OrderStatus; trackingNumber?: string } = {};
      if (requestedStatus) updateData.status = requestedStatus;
      if (trackingNumber !== undefined) updateData.trackingNumber = trackingNumber;

      const updated = await db.order.updateMany({
        where: {
          id: order.id,
          ...(requestedStatus ? { status: order.status } : {}),
        },
        data: updateData,
      });
      if (updated.count !== 1) {
        return NextResponse.json({ error: "Order was changed by another request" }, { status: 409 });
      }
      updatedOrder = await db.order.findUnique({
        where: { id: order.id },
        include: { user: true },
      });
    }

    if (!updatedOrder) {
      return NextResponse.json({ error: "Order not found after update" }, { status: 404 });
    }

    // Only send email if status is SHIPPED or DELIVERED
    const email = updatedOrder.user?.email || updatedOrder.guestEmail;
    if (email && (updatedOrder.status === "SHIPPED" || updatedOrder.status === "DELIVERED")) {
      await sendOrderStatusUpdateEmail(
        email,
        updatedOrder.id,
        updatedOrder.status,
        updatedOrder.trackingNumber
      );
    }

    return NextResponse.json(updatedOrder);
  } catch (error) {
    logger.error("Order update failed", {
      orderId: params.id,
      name: error instanceof Error ? error.name : undefined,
    });
    return NextResponse.json(
      { error: "Failed to update order" },
      { status: 500 }
    );
  }
}
