import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sendLowStockAlert, sendNewOrderNotificationEmail, sendOrderConfirmationEmail } from "@/lib/email";
import { checkRateLimit } from "@/lib/rate-limit";
import { createOrderSchema } from "@/lib/validations";
import { createGuestOrderToken, guestOrderTokensConfigured } from "@/lib/guest-order-token";
import { createManualOrder, OrderConfigurationError, OrderConflictError, OrderInputError } from "@/lib/manual-order";
import { getTrustedClientIdentifier } from "@/lib/request-identity";
import { paymentFallbackMessage } from "@/lib/payment-instructions";
import { releaseExpiredReservations } from "@/lib/reservation-cleanup";
import { z } from "zod";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const sessionUserId = session?.user?.id || null;
    const user = sessionUserId
      ? await db.user.findUnique({ where: { id: sessionUserId }, select: { id: true, email: true } })
      : null;
    const identifier = user?.id || getTrustedClientIdentifier(request);
    const rateLimit = await checkRateLimit(identifier, "orders");
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: rateLimit.unavailable ? "Checkout protection is temporarily unavailable" : "Too many requests" },
        { status: rateLimit.unavailable ? 503 : 429 },
      );
    }

    const idempotencyKey = request.headers.get("idempotency-key") || "";
    const body = createOrderSchema.parse(await request.json());
    if (!user && !guestOrderTokensConfigured()) {
      throw new OrderConfigurationError("Guest checkout is unavailable until signed order links are configured");
    }
    await releaseExpiredReservations();
    const result = await createManualOrder(db, {
      actor: { userId: user?.id || null, role: session?.user?.role, guestEmail: body.guestEmail },
      idempotencyKey,
      items: body.items.map(({ productId, quantity }) => ({ productId, quantity })),
      shippingAddress: body.shippingAddress,
      shippingAddressId: body.shippingAddressId,
      billingAddressId: body.billingAddressId,
      discountCode: body.discountCode,
    });

    const guestAccessToken = user ? undefined : createGuestOrderToken(result.orderId);
    const orderUrl = `/orders/${encodeURIComponent(result.orderId)}${guestAccessToken ? `?token=${encodeURIComponent(guestAccessToken)}` : ""}`;
    const publicStoreUrl = process.env.NEXT_PUBLIC_STORE_URL?.replace(/\/$/, "");
    const orderAccessUrl = publicStoreUrl ? `${publicStoreUrl}${orderUrl}` : undefined;
    const order = await db.order.findUnique({
      where: { id: result.orderId },
      include: { items: { include: { product: true } }, user: true },
    });
    if (order && !result.replayed) {
      const paymentOrder = order as typeof order & {
        paymentIban?: string | null;
        paymentBankName?: string | null;
        paymentAccountName?: string | null;
        paymentDetails?: string | null;
      };
      const customerEmail = order.user?.email || order.guestEmail;
      if (customerEmail) {
        await sendOrderConfirmationEmail(customerEmail, {
          orderNumber: order.orderNumber || order.id,
          orderId: order.id,
          total: Number(order.total),
          subtotal: Number(order.subtotal),
          tax: Number(order.tax),
          shippingCost: Number(order.shippingCost),
          currency: order.currency,
          items: order.items.map((item) => ({ name: item.product.name, qty: item.quantity, price: Number(item.price) })),
          paymentIban: paymentOrder.paymentIban,
          paymentBankName: paymentOrder.paymentBankName,
          paymentAccountName: paymentOrder.paymentAccountName,
          paymentDetails: paymentOrder.paymentDetails,
          orderAccessUrl,
        });
      }
      const settings = await db.storeSettings.findFirst();
      if (settings?.storeEmail) await sendNewOrderNotificationEmail(order as any, settings as any);
      await Promise.allSettled(order.items.map(async (item) => {
        const product = await db.product.findUnique({ where: { id: item.productId } });
        if (product && product.stock < 5) await sendLowStockAlert(product.name, product.stock);
      }));
    }

    return NextResponse.json({
      ...result,
      paymentFallbackMessage: !result.paymentIban
        ? paymentFallbackMessage(result.paymentDetails)
        : null,
      guestAccessToken,
      orderUrl,
    }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof OrderInputError) {
      return NextResponse.json({ error: error instanceof OrderInputError ? error.message : "Invalid input" }, { status: 400 });
    }
    if (error instanceof OrderConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof OrderConfigurationError) return NextResponse.json({ error: error.message }, { status: 503 });
    console.error("Order creation failed");
    return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const orders = await db.order.findMany({
      where: { reservationExpiresAt: { not: null } } as any,
      include: {
        user: { select: { id: true, name: true, email: true } },
        shippingAddress: true,
        items: { include: { product: { select: { id: true, name: true, price: true, image: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(orders);
  } catch {
    console.error("Order listing failed");
    return NextResponse.json({ error: "Failed to fetch orders" }, { status: 500 });
  }
}
