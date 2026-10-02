import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createGuestOrderToken, guestOrderTokensConfigured, verifyGuestOrderToken } from "@/lib/guest-order-token";
import { ORDER_STATUSES, OrderStatusValue } from "@/lib/order-lifecycle";
import { OrderConflictError, OrderInputError, transitionManualOrder } from "@/lib/manual-order";
import { sendOrderStatusUpdateEmail } from "@/lib/email";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const detailInclude = {
  user: { select: { id: true, name: true, email: true } },
  shippingAddress: true,
  billingAddress: true,
  items: { include: { product: { select: { id: true, name: true, image: true } } } },
};

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const order = await db.order.findUnique({ where: { id: params.id }, include: detailInclude });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (!(order as any).reservationExpiresAt) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  const allowed = session?.user?.role === "ADMIN" ||
    (!!session?.user?.id && order.userId === session.user.id) ||
    (!order.userId && verifyGuestOrderToken(request.nextUrl.searchParams.get("token"), order.id));
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(order);
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = z.object({
      status: z.enum(ORDER_STATUSES),
      trackingNumber: z.string().trim().max(200).nullable().optional(),
    }).parse(await request.json());
    const updatedOrder = await transitionManualOrder(db, {
      orderId: params.id,
      nextStatus: body.status as OrderStatusValue,
      adminUserId: session.user.id,
      trackingNumber: body.trackingNumber,
      recoverExpired: body.status === "PENDING",
    });
    const email = updatedOrder.user?.email || updatedOrder.guestEmail;
    if (email && ["CONFIRMED", "SHIPPED", "DELIVERED"].includes(updatedOrder.status)) {
      const storeUrl = process.env.NEXT_PUBLIC_STORE_URL?.replace(/\/$/, "");
      const token = updatedOrder.userId || !guestOrderTokensConfigured() ? null : createGuestOrderToken(updatedOrder.id);
      const orderAccessUrl = storeUrl
        ? `${storeUrl}/orders/${encodeURIComponent(updatedOrder.id)}${token ? `?token=${encodeURIComponent(token)}` : ""}`
        : undefined;
      await sendOrderStatusUpdateEmail(
        email,
        updatedOrder.orderNumber || updatedOrder.id,
        updatedOrder.status,
        updatedOrder.trackingNumber,
        orderAccessUrl,
      );
    }
    return NextResponse.json(updatedOrder);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof OrderInputError) {
      return NextResponse.json({ error: error instanceof OrderInputError ? error.message : "Invalid input" }, { status: 400 });
    }
    if (error instanceof OrderConflictError || error instanceof Error && error.message.startsWith("Invalid order transition")) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("Order update failed");
    return NextResponse.json({ error: "Failed to update order" }, { status: 500 });
  }
}
