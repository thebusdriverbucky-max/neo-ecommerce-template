import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, withDbRetry } from "@/lib/db";
import { sendLowStockAlert } from "@/lib/email";
import { generateOrderNumber } from "@/lib/order-number";
import { confirmOrder, handleOrderCancellation } from "@/lib/order-confirmation";
import { checkRateLimit } from "@/lib/rate-limit";
import { createGuestOrderToken, createGuestOrderTokenExpiry, hashGuestOrderToken } from "@/lib/guest-order-token";
import { logger } from "@/lib/logger";
import { normalizeCurrency, roundMoney, toMinorUnits } from "@/lib/money";
import { calculateCheckoutTotals } from "@/lib/checkout-totals";
import { buildDiscountedProductLineItems } from "@/lib/stripe-line-items";
import { getTrustedClientIdentifier } from "@/lib/request-identity";
import { createOrderSchema } from "@/lib/validations";
import { stripe } from "@/lib/stripe";

type CheckoutItem = {
  productId: string;
  quantity: number;
  price: Prisma.Decimal;
};

type DiscountRecord = {
  type: "FIXED" | "PERCENT";
  value: number;
};

function makeSuccessUrl(appUrl: string, orderId: string, guestToken?: string): string {
  const url = new URL(`/orders/${orderId}`, appUrl);
  url.searchParams.set("success", "true");
  if (guestToken) url.searchParams.set("guest_token", guestToken);
  return url.toString();
}

async function existingCheckoutResponse(
  order: {
    id: string;
    stripeCheckoutSessionId: string | null;
    guestAccessTokenExpiresAt: Date | null;
  }
): Promise<NextResponse> {
  if (!order.stripeCheckoutSessionId) {
    return NextResponse.json(
      { error: "This checkout is already being initialized. Please retry with a new checkout." },
      { status: 409 }
    );
  }

  const session = await stripe.checkout.sessions.retrieve(order.stripeCheckoutSessionId);
  if (!session.url) {
    return NextResponse.json(
      { error: "The checkout session is no longer available. Please retry." },
      { status: 409 }
    );
  }

  const guestAccessToken = order.guestAccessTokenExpiresAt
    ? createGuestOrderToken(order.id, order.guestAccessTokenExpiresAt)
    : undefined;

  return NextResponse.json({
    url: session.url,
    orderId: order.id,
    guestAccessToken,
    reused: true,
  });
}

export async function createOrderCheckout(request: NextRequest): Promise<NextResponse> {
  let createdOrderId: string | null = null;
  let stripeSession: Stripe.Checkout.Session | null = null;
  let createdGuestToken: string | undefined;

  try {
    const session = await auth();
    const sessionUserId = session?.user?.id;
    let dbUserId: string | null = null;

    if (sessionUserId) {
      const user = await db.user.findUnique({ where: { id: sessionUserId }, select: { id: true } });
      if (!user) {
        return NextResponse.json({ error: "Authentication session is no longer valid" }, { status: 401 });
      }
      dbUserId = user.id;
    }

    const rawBody = await request.json();
    const parsed = createOrderSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid checkout input", details: parsed.error.issues }, { status: 400 });
    }

    const {
      items,
      shippingAddress,
      guestEmail: submittedGuestEmail,
      shippingAddressId,
      billingAddressId,
      discountCode,
      checkoutRequestId,
    } = parsed.data;
    const guestEmail = submittedGuestEmail?.trim().toLowerCase() || shippingAddress?.email?.trim().toLowerCase();

    if (!dbUserId && (!guestEmail || !shippingAddress)) {
      return NextResponse.json(
        { error: "Guest checkout requires an email address and shipping address" },
        { status: 400 }
      );
    }

    if (!dbUserId && (shippingAddressId || billingAddressId)) {
      return NextResponse.json({ error: "Saved addresses require an authenticated account" }, { status: 400 });
    }

    if (shippingAddressId && shippingAddress) {
      return NextResponse.json({ error: "Use either a saved or a new shipping address" }, { status: 400 });
    }

    const rateLimitKey = dbUserId || guestEmail || getTrustedClientIdentifier(request);
    const rateLimit = await checkRateLimit(rateLimitKey, "orders");
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: rateLimit.unavailable ? "Checkout protection is temporarily unavailable. Please try again shortly." : "Too many checkout attempts. Please try again later." },
        { status: rateLimit.unavailable ? 503 : 429 }
      );
    }

    const requestId = checkoutRequestId || randomUUID();
    const existingOrder = await db.order.findUnique({
      where: { checkoutRequestId: requestId },
      select: {
        id: true,
        userId: true,
        guestEmail: true,
        status: true,
        stripeCheckoutSessionId: true,
        guestAccessTokenExpiresAt: true,
      },
    });

    if (existingOrder) {
      const sameOwner = dbUserId
        ? existingOrder.userId === dbUserId
        : !existingOrder.userId && existingOrder.guestEmail === guestEmail;
      if (!sameOwner) {
        return NextResponse.json({ error: "Checkout request cannot be reused" }, { status: 409 });
      }
      return existingCheckoutResponse(existingOrder);
    }

    const pendingOwnerFilter = dbUserId ? [{ userId: dbUserId }] : guestEmail ? [{ guestEmail }] : [];
    const pendingOrdersCount = pendingOwnerFilter.length
      ? await db.order.count({
          where: {
            OR: pendingOwnerFilter,
            status: "PENDING",
            createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
          },
        })
      : 0;

    if (pendingOrdersCount >= 3) {
      return NextResponse.json(
        { error: "You have too many pending orders. Complete or cancel one before placing another." },
        { status: 429 }
      );
    }

    const storeSettings = await db.storeSettings.findFirst();
    let currency: string;
    try {
      currency = normalizeCurrency(storeSettings?.currency || "USD");
    } catch {
      return NextResponse.json({ error: "The store currency is not supported for payments" }, { status: 500 });
    }

    if (dbUserId && (shippingAddressId || billingAddressId)) {
      const addressIds = [shippingAddressId, billingAddressId].filter((id): id is string => Boolean(id));
      const ownedAddresses = await db.address.count({
        where: { id: { in: addressIds }, userId: dbUserId },
      });
      if (ownedAddresses !== new Set(addressIds).size) {
        return NextResponse.json({ error: "One or more selected addresses are not yours" }, { status: 403 });
      }
    }

    const quantities = new Map<string, number>();
    for (const item of items) {
      quantities.set(item.productId, (quantities.get(item.productId) || 0) + item.quantity);
    }

    const products = await db.product.findMany({
      where: { id: { in: [...quantities.keys()] }, isArchived: false },
    });
    const productsById = new Map(products.map((product) => [product.id, product]));
    const orderItemsData: CheckoutItem[] = [];
    let subtotal = new Prisma.Decimal(0);

    for (const [productId, quantity] of quantities) {
      const product = productsById.get(productId);
      if (!product) {
        return NextResponse.json({ error: "One or more products are unavailable" }, { status: 400 });
      }
      if (product.stock < quantity) {
        return NextResponse.json({ error: `Insufficient stock for ${product.name}` }, { status: 409 });
      }

      const price = roundMoney(product.price, currency);
      subtotal = subtotal.add(price.mul(quantity));
      orderItemsData.push({ productId, quantity, price });
    }

    subtotal = roundMoney(subtotal, currency);
    let discount: DiscountRecord | null = null;

    if (discountCode) {
      const found = await db.discountCode.findUnique({ where: { code: discountCode.toUpperCase() } });
      if (!found || !found.isActive || (found.expiresAt && found.expiresAt <= new Date())) {
        return NextResponse.json({ error: "Invalid or expired discount code" }, { status: 400 });
      }
      if (found.type === "PERCENT" && (found.value <= 0 || found.value > 100)) {
        return NextResponse.json({ error: "The discount configuration is invalid" }, { status: 400 });
      }
      discount = { type: found.type, value: found.value };
    }

    const configuredTaxRate = new Prisma.Decimal(storeSettings?.taxRate ?? 0);
    const configuredShipping = new Prisma.Decimal(storeSettings?.shippingCost ?? 0);
    const freeShippingThreshold = new Prisma.Decimal(storeSettings?.freeShippingThreshold ?? 500);
    if (![configuredTaxRate, configuredShipping, freeShippingThreshold].every((value) => value.isFinite()) || configuredTaxRate.isNegative() || configuredTaxRate.gt(100) || configuredShipping.isNegative() || freeShippingThreshold.isNegative()) {
      return NextResponse.json({ error: "Store payment settings are invalid" }, { status: 500 });
    }

    const totals = calculateCheckoutTotals({
      currency,
      subtotal,
      discount,
      taxRate: configuredTaxRate,
      shippingCost: configuredShipping,
      freeShippingThreshold,
    });
    const { discountAmount, tax, shipping, total: finalTotal } = totals;
    const { discountMinor, taxMinor, shippingMinor, totalMinor: finalTotalMinor } = totals;
    const productMinor = totals.subtotalMinor;
    if (productMinor - discountMinor + taxMinor + shippingMinor !== finalTotalMinor) {
      throw new Error("CHECKOUT_TOTAL_MISMATCH");
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl || !/^https?:\/\//i.test(appUrl)) {
      return NextResponse.json({ error: "NEXT_PUBLIC_APP_URL is not configured correctly" }, { status: 500 });
    }

    const guestTokenExpiry = dbUserId ? null : createGuestOrderTokenExpiry();
    const createOrderTransaction = () => db.$transaction(async (tx) => {
      let finalShippingAddressId = shippingAddressId || null;
      if (shippingAddress) {
        const newAddress = await tx.address.create({
          data: {
            ...shippingAddress,
            email: shippingAddress.email.trim().toLowerCase(),
            userId: dbUserId,
          },
        });
        finalShippingAddressId = newAddress.id;
      }

      const orderNumber = await generateOrderNumber();
      const created = await tx.order.create({
        data: {
          orderNumber,
          checkoutRequestId: requestId,
          status: "PENDING",
          subtotal,
          discountAmount,
          tax,
          shippingCost: shipping,
          total: finalTotal,
          currency,
          shippingAddressId: finalShippingAddressId,
          billingAddressId: billingAddressId || null,
          userId: dbUserId,
          guestEmail: dbUserId ? null : guestEmail,
          guestAccessTokenExpiresAt: guestTokenExpiry,
          items: {
            create: orderItemsData.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              price: item.price,
            })),
          },
        },
      });

      for (const item of orderItemsData) {
        const updated = await tx.product.updateMany({
          where: { id: item.productId, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        });
        if (updated.count !== 1) {
          throw new Error(`INSUFFICIENT_STOCK:${item.productId}`);
        }
      }

      if (!guestTokenExpiry) return created;
      const guestToken = createGuestOrderToken(created.id, guestTokenExpiry);
      createdGuestToken = guestToken;
      return tx.order.update({
        where: { id: created.id },
        data: { guestAccessTokenHash: hashGuestOrderToken(guestToken) },
      });
    });

    let order;
    try {
      order = await withDbRetry(createOrderTransaction);
    } catch (error: any) {
      if (String(error?.message || "").startsWith("INSUFFICIENT_STOCK:")) {
        return NextResponse.json({ error: "Insufficient stock for one or more products" }, { status: 409 });
      }
      if (error?.code === "P2002") {
        const duplicate = await db.order.findUnique({
          where: { checkoutRequestId: requestId },
          select: {
            id: true,
            userId: true,
            guestEmail: true,
            status: true,
            stripeCheckoutSessionId: true,
            guestAccessTokenExpiresAt: true,
          },
        });
        if (duplicate) return existingCheckoutResponse(duplicate);
      }
      throw error;
    }
    createdOrderId = order.id;

    await Promise.allSettled(
      orderItemsData.map(async (item) => {
        const product = await db.product.findUnique({ where: { id: item.productId }, select: { name: true, stock: true } });
        if (product && product.stock < 5) await sendLowStockAlert(product.name, product.stock);
      })
    );

    const productLineItems = orderItemsData.map((item) => {
      const product = productsById.get(item.productId);
      return {
        name: product?.name || "Product",
        image: product?.image || undefined,
        unitAmountMinor: toMinorUnits(item.price, currency),
        quantity: item.quantity,
      };
    });
    const lineItems = buildDiscountedProductLineItems(currency, productLineItems, discountMinor);

    if (taxMinor > 0) {
      lineItems.push({
        price_data: {
          currency: currency.toLowerCase(),
          product_data: { name: "Tax" },
          unit_amount: taxMinor,
        },
        quantity: 1,
      });
    }

    // Shipping is already included in the server-calculated order total.
    // Keep it as a line item instead of using Checkout `shipping_options`,
    // which would add the amount a second time (and allow the customer to
    // choose a different shipping total than the persisted order).
    if (shippingMinor > 0) {
      lineItems.push({
        price_data: {
          currency: currency.toLowerCase(),
          product_data: { name: "Shipping" },
          unit_amount: shippingMinor,
        },
        quantity: 1,
      });
    }

    const guestToken = createdGuestToken || (guestTokenExpiry ? createGuestOrderToken(order.id, guestTokenExpiry) : undefined);

    if (finalTotalMinor === 0) {
      await confirmOrder(order.id, {}, storeSettings);
      return NextResponse.json({
        url: makeSuccessUrl(appUrl, order.id, guestToken),
        orderId: order.id,
        guestAccessToken: guestToken,
        freeOrder: true,
      });
    }

    try {
      stripeSession = await stripe.checkout.sessions.create(
        {
          payment_method_types: ["card"],
          line_items: lineItems,
          mode: "payment",
          success_url: makeSuccessUrl(appUrl, order.id, guestToken),
          cancel_url: `${new URL("/checkout", appUrl).toString()}?canceled=true`,
          customer_email: guestEmail || session?.user?.email || undefined,
          metadata: { orderId: order.id, checkoutRequestId: requestId, ...(dbUserId && { userId: dbUserId }) },
          payment_intent_data: {
            metadata: { orderId: order.id, checkoutRequestId: requestId, ...(dbUserId && { userId: dbUserId }) },
          },
          expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
        },
        { idempotencyKey: `checkout_${order.id}` }
      );

      const paymentIntentId = typeof stripeSession.payment_intent === "string"
        ? stripeSession.payment_intent
        : null;
      await db.order.update({
        where: { id: order.id },
        data: {
          stripeCheckoutSessionId: stripeSession.id,
          stripePaymentIntentId: paymentIntentId,
        },
      });
    } catch (stripeError: any) {
      logger.error("Stripe Checkout Session creation failed", {
        orderId: order.id,
        code: stripeError?.code,
        type: stripeError?.type,
      });

      // If Stripe did not return a Session, no paid webhook can arrive for
      // this order and the reserved stock can safely be released now. If a
      // Session exists but the DB write failed, leave it pending for the
      // reconciliation job instead of risking a paid order being cancelled.
      if (!stripeSession) await handleOrderCancellation(order.id);

      return NextResponse.json({ error: "Payment initialization failed" }, { status: 502 });
    }

    if (!stripeSession.url) {
      return NextResponse.json({ error: "Stripe did not return a checkout URL" }, { status: 502 });
    }

    return NextResponse.json({ url: stripeSession.url, orderId: order.id, guestAccessToken: guestToken });
  } catch (error: any) {
    logger.error("Order checkout failed", {
      orderId: createdOrderId,
      code: error?.code,
      name: error?.name,
      message: process.env.NODE_ENV === "development" ? error?.message : undefined,
    });

    if (createdOrderId && !stripeSession) {
      try {
        await handleOrderCancellation(createdOrderId);
      } catch (cleanupError: any) {
        logger.error("Failed to release checkout reservation", { orderId: createdOrderId, code: cleanupError?.code });
      }
    }

    return NextResponse.json(
      { error: error?.message === "CHECKOUT_TOTAL_MISMATCH" ? "Unable to calculate checkout total" : "Failed to create order" },
      { status: 500 }
    );
  }
}
