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

    const updateData: any = {};
    if (status) updateData.status = status;
    if (trackingNumber !== undefined) updateData.trackingNumber = trackingNumber;

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
