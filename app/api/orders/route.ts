import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sendOrderPlacedEmails } from "@/lib/email";
import { checkRateLimit } from "@/lib/rate-limit";
import { createOrderSchema } from "@/lib/validations";
import { createGuestOrderToken, guestOrderTokensConfigured } from "@/lib/guest-order-token";
import {
  createManualOrder,
  INTERNAL_ORDER_FIELDS,
  OrderConfigurationError,
  OrderConflictError,
  OrderInputError,
  OrderLimitError,
} from "@/lib/manual-order";
import { getTrustedClientIdentifier, hashClientIdentifier } from "@/lib/request-identity";
import { paymentFallbackMessage } from "@/lib/payment-instructions";
import { releaseExpiredReservationsSafely } from "@/lib/reservation-cleanup";
import { parseOrderListQuery } from "@/lib/admin-orders";
import { getStoreSettings } from "@/lib/store-settings";
import { logger } from "@/lib/logger";
import { z } from "zod";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const sessionUserId = session?.user?.id || null;
    const user = sessionUserId
      ? await db.user.findUnique({ where: { id: sessionUserId }, select: { id: true, email: true } })
      : null;
    const clientIdentifier = getTrustedClientIdentifier(request);
    const rateLimit = await checkRateLimit(user?.id || clientIdentifier, "orders");
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
    // Returns stock from expired orders first; a failure here must not block checkout.
    await releaseExpiredReservationsSafely();
    const result = await createManualOrder(db, {
      actor: { userId: user?.id || null, role: session?.user?.role, guestEmail: body.guestEmail },
      idempotencyKey,
      items: body.items.map(({ productId, quantity }) => ({ productId, quantity })),
      shippingAddress: body.shippingAddress,
      shippingAddressId: body.shippingAddressId,
      billingAddressId: body.billingAddressId,
      discountCode: body.discountCode,
      checkoutIpHash: hashClientIdentifier(clientIdentifier),
    });

    const guestAccessToken = user ? undefined : createGuestOrderToken(result.orderId);
    const orderUrl = `/orders/${encodeURIComponent(result.orderId)}${guestAccessToken ? `?token=${encodeURIComponent(guestAccessToken)}` : ""}`;

    if (!result.replayed) {
      // The order is committed; email problems are logged and never fail checkout.
      try {
        const order = await db.order.findUnique({
          where: { id: result.orderId },
          include: {
            user: { select: { email: true } },
            shippingAddress: true,
            items: { include: { product: { select: { name: true } } } },
          },
        });
        if (order) await sendOrderPlacedEmails(order, await getStoreSettings());
      } catch (error) {
        logger.warn("Order emails failed", { orderId: result.orderId, name: error instanceof Error ? error.name : undefined });
      }
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
    if (error instanceof OrderLimitError) return NextResponse.json({ error: error.message }, { status: 429 });
    if (error instanceof OrderConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof OrderConfigurationError) return NextResponse.json({ error: error.message }, { status: 503 });
    logger.error("Order creation failed", { name: error instanceof Error ? error.name : undefined });
    return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
  }
}

/**
 * GET /api/orders (admin only)
 * Without ?page: the legacy array of all bank-transfer orders, newest first.
 * With ?page (and optional pageSize, status, q): { orders, total, page, pageSize }.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const query = parseOrderListQuery(request.nextUrl.searchParams);
    if (!query.ok) return NextResponse.json({ error: query.error }, { status: 400 });

    // Shows expired orders as Cancelled and returns their stock.
    await releaseExpiredReservationsSafely();
    const where = { ...query.where, reservationExpiresAt: { not: null } };
    const findArgs = {
      where,
      omit: INTERNAL_ORDER_FIELDS,
      include: {
        user: { select: { id: true, name: true, email: true } },
        shippingAddress: true,
        items: { include: { product: { select: { id: true, name: true, price: true, image: true } } } },
      },
      orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    };
    if (!query.paginated) return NextResponse.json(await db.order.findMany(findArgs));

    const [orders, total] = await Promise.all([
      db.order.findMany({ ...findArgs, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      db.order.count({ where }),
    ]);
    return NextResponse.json({ orders, total, page: query.page, pageSize: query.pageSize });
  } catch (error) {
    logger.error("Order listing failed", { name: error instanceof Error ? error.name : undefined });
    return NextResponse.json({ error: "Failed to fetch orders" }, { status: 500 });
  }
}
