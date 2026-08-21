import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
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
    if (session.user.role !== "ADMIN" && order.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { status, trackingNumber } = body;

    // Whitelist of statuses a user is allowed to set.
    // Payment-related transitions (PENDING -> CONFIRMED) must only ever
    // happen through the Stripe webhook, never through this endpoint.
    const ALLOWED_STATUSES = ["CANCELLED", "SHIPPED", "DELIVERED"] as const;

    const updateData: any = {};
    if (status) {
      if (typeof status !== "string" || !(ALLOWED_STATUSES as readonly string[]).includes(status)) {
        return NextResponse.json(
          { error: `Invalid status. Allowed: ${ALLOWED_STATUSES.join(", ")}` },
          { status: 400 }
        );
      }
      // Non-admins may only cancel their own pending order
      if (session.user.role !== "ADMIN" && status !== "CANCELLED") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      // Cancelling a pending order returns the reserved stock
      if (status === "CANCELLED" && order.status === "PENDING") {
        const items = await db.orderItem.findMany({
          where: { orderId: order.id },
        });
        await db.$transaction(async (tx) => {
          for (const item of items) {
            await tx.product.update({
              where: { id: item.productId },
              data: { stock: { increment: item.quantity } },
            });
          }
        });
      }
      updateData.status = status;
    }
    if (trackingNumber !== undefined) {
      if (typeof trackingNumber !== "string" || trackingNumber.length > 100) {
        return NextResponse.json({ error: "Invalid trackingNumber" }, { status: 400 });
      }
      updateData.trackingNumber = trackingNumber;
    }

    const updatedOrder = await db.order.update({
      where: { id: params.id },
      data: updateData,
      include: { user: true },
    });

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
    console.error("Order update error:", error);
    return NextResponse.json(
      { error: "Failed to update order" },
      { status: 500 }
    );
  }
}
