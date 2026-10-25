import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, withDbRetry } from "@/lib/db";
import { allocateOrderNumber, isOrderNumberConflict, resyncOrderNumberCounter } from "@/lib/order-number";
import { cancelPendingOrder, confirmOrder, handleOrderCancellation } from "@/lib/order-confirmation";
import { checkRateLimit, type RateLimitResult } from "@/lib/rate-limit";
import {
  createGuestOrderToken,
  createGuestOrderTokenExpiry,
  hashGuestOrderToken,
  verifyGuestOrderToken,
} from "@/lib/guest-order-token";
import { logger } from "@/lib/logger";
import { fromMinorUnits, normalizeCurrency, roundMoney, toMinorUnits } from "@/lib/money";
import { calculateCheckoutTotals } from "@/lib/checkout-totals";
import { buildDiscountedProductLineItems } from "@/lib/stripe-line-items";
import { ANONYMOUS_CLIENT, getTrustedClientIdentifier, hashClientIdentifier } from "@/lib/request-identity";
import { getStoreSettings } from "@/lib/store-settings";
import { isCountryEnabled, resolveFreeShippingThreshold } from "@/lib/shipping";
import { isBelowStripeMinimum, stripeMinimumChargeMinor } from "@/lib/stripe-minimums";
import { discountAvailabilityError } from "@/lib/discounts";
import { createOrderSchema } from "@/lib/validations";
import { stripe } from "@/lib/stripe";
import { getStripeDeploymentId } from "@/lib/stripe-payment-integrity";

type CheckoutItem = {
  productId: string;
  quantity: number;
  price: Prisma.Decimal;
};

type DiscountRecord = {
  type: "FIXED" | "PERCENT";
  value: number;
};

type PreviousCheckout = {
  orderId: string;
  guestAccessToken?: string;
};

const PENDING_WINDOW_MS = 30 * 60 * 1000;
const MAX_PENDING_PER_OWNER = 3;
const MAX_PENDING_PER_IP = 5;
const MAX_ORDER_NUMBER_ATTEMPTS = 3;

/**
 * Every non-OK response of POST /api/orders has the shape
 * { error, code?, ...extra } so the checkout UI can react to `code`.
 */
function checkoutError(
  status: number,
  error: string,
  code?: string,
  extra?: Record<string, unknown>
): NextResponse {
  return NextResponse.json({ error, ...(code ? { code } : {}), ...extra }, { status });
}

function rateLimitResponse(result: RateLimitResult): NextResponse | null {
  if (result.success) return null;
  return checkoutError(
    result.unavailable ? 503 : 429,
    result.unavailable
      ? "Checkout protection is temporarily unavailable. Please try again shortly."
      : "Too many checkout attempts. Please try again later.",
    "RATE_LIMITED"
  );
}

function belowMinimumResponse(currency: string, minimumMinor: number | null): NextResponse {
  if (minimumMinor === null) {
    return checkoutError(
      400,
      "The order total is below the minimum amount that can be paid by card. Add more items to continue.",
      "BELOW_MINIMUM_AMOUNT",
      { currency }
    );
  }
  const minimumAmount = fromMinorUnits(minimumMinor, currency).toNumber();
  let formatted: string;
  try {
    formatted = new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minimumAmount);
  } catch {
    formatted = `${minimumAmount} ${currency}`;
  }
  return checkoutError(
    400,
    `The order total is below the minimum card payment of ${formatted}. Add more items to continue.`,
    "BELOW_MINIMUM_AMOUNT",
    { minimumAmount, currency }
  );
}

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
    return checkoutError(
      409,
      "This checkout is already being initialized. Please retry with a new checkout.",
      "CHECKOUT_REUSE_CONFLICT"
    );
  }

  const session = await stripe.checkout.sessions.retrieve(order.stripeCheckoutSessionId);
  if (!session.url) {
    return checkoutError(
      409,
      "The checkout session is no longer available. Please retry.",
      "CHECKOUT_REUSE_CONFLICT"
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

/**
 * Cancels earlier unpaid checkouts the caller proves to own, so a customer
 * coming back from Stripe is not blocked by their own stock reservation or
 * pending-order limit. Entries that are not owned, not found or not pending
 * are ignored silently so the response never reveals whether an order exists.
 * Returns a response only when one of them turned out to be paid already.
 */
async function supersedePreviousCheckouts(
  previousCheckouts: PreviousCheckout[],
  dbUserId: string | null,
  currentRequestId: string | undefined
): Promise<NextResponse | null> {
  const requested = new Map<string, PreviousCheckout>();
  for (const entry of previousCheckouts) {
    if (!requested.has(entry.orderId)) requested.set(entry.orderId, entry);
  }
  if (requested.size === 0) return null;

  const orders = await db.order.findMany({
    where: { id: { in: [...requested.keys()] } },
    select: {
      id: true,
      userId: true,
      status: true,
      checkoutRequestId: true,
      guestAccessTokenHash: true,
      guestAccessTokenExpiresAt: true,
    },
  });

  for (const order of orders) {
    if (order.status !== "PENDING") continue;
    // A retry of the current request must not cancel its own order.
    if (currentRequestId && order.checkoutRequestId === currentRequestId) continue;

    const guestAccessToken = requested.get(order.id)?.guestAccessToken;
    const owned = dbUserId
      ? order.userId === dbUserId
      : !order.userId
        && Boolean(guestAccessToken)
        && verifyGuestOrderToken(
          guestAccessToken || "",
          order.id,
          order.guestAccessTokenHash,
          order.guestAccessTokenExpiresAt
        );
    if (!owned) continue;

    const result = await cancelPendingOrder(order.id);
    if (result.outcome === "confirmed") {
      return checkoutError(
        409,
        "A previous checkout from this browser has already been paid. Check that order before paying again.",
        "PREVIOUS_CHECKOUT_PAID",
        { orderId: order.id, ...(dbUserId ? {} : { guestAccessToken }) }
      );
    }
    if (result.outcome === "error") {
      logger.warn("Previous checkout could not be superseded", { orderId: order.id });
    }
  }
  return null;
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
        return checkoutError(401, "Authentication session is no longer valid");
      }
      dbUserId = user.id;
    }

    const rawBody = await request.json();
    const parsed = createOrderSchema.safeParse(rawBody);
    if (!parsed.success) {
      return checkoutError(400, "Invalid checkout input", "INVALID_INPUT", { details: parsed.error.issues });
    }

    const {
      items,
      shippingAddress,
      guestEmail: submittedGuestEmail,
      shippingAddressId,
      billingAddressId,
      discountCode,
      checkoutRequestId,
      previousCheckouts,
    } = parsed.data;
    const guestEmail = submittedGuestEmail?.trim().toLowerCase() || shippingAddress?.email?.trim().toLowerCase();

    if (!dbUserId && (!guestEmail || !shippingAddress)) {
      return checkoutError(400, "Guest checkout requires an email address and shipping address", "INVALID_INPUT");
    }

    if (!dbUserId && (shippingAddressId || billingAddressId)) {
      return checkoutError(400, "Saved addresses require an authenticated account", "INVALID_INPUT");
    }

    if (shippingAddressId && shippingAddress) {
      return checkoutError(400, "Use either a saved or a new shipping address", "INVALID_INPUT");
    }

    // Release this browser's earlier unpaid checkouts first, so they neither
    // block the stock check nor count against the pending-order limits.
    if (previousCheckouts?.length) {
      const paidResponse = await supersedePreviousCheckouts(previousCheckouts, dbUserId, checkoutRequestId);
      if (paidResponse) return paidResponse;
    }

    const clientIp = getTrustedClientIdentifier(request);
    const rateLimitKey = dbUserId || guestEmail || clientIp;
    const limited = rateLimitResponse(await checkRateLimit(rateLimitKey, "orders"));
    if (limited) return limited;
    if (clientIp !== ANONYMOUS_CLIENT) {
      // Only enforced with Upstash configured; otherwise checkRateLimit defers
      // to the external edge limiter.
      const ipLimited = rateLimitResponse(await checkRateLimit(clientIp, "ordersIp"));
      if (ipLimited) return ipLimited;
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
        return checkoutError(409, "Checkout request cannot be reused", "CHECKOUT_REUSE_CONFLICT");
      }
      return existingCheckoutResponse(existingOrder);
    }

    const pendingSince = new Date(Date.now() - PENDING_WINDOW_MS);
    const pendingOwnerFilter = dbUserId ? [{ userId: dbUserId }] : guestEmail ? [{ guestEmail }] : [];
    const pendingOrdersCount = pendingOwnerFilter.length
      ? await db.order.count({
          where: {
            OR: pendingOwnerFilter,
            status: "PENDING",
            createdAt: { gte: pendingSince },
          },
        })
      : 0;

    if (pendingOrdersCount >= MAX_PENDING_PER_OWNER) {
      return checkoutError(
        429,
        "You have too many pending orders. Complete or cancel one before placing another.",
        "TOO_MANY_PENDING"
      );
    }

    // Works without Redis: unpaid reservations are counted per hashed client IP
    // (Vercel only; the identifier is "anonymous" elsewhere and the check is skipped).
    const checkoutIpHash = hashClientIdentifier(clientIp);
    if (checkoutIpHash) {
      const pendingFromIp = await db.order.count({
        where: { checkoutIpHash, status: "PENDING", createdAt: { gte: pendingSince } },
      });
      if (pendingFromIp >= MAX_PENDING_PER_IP) {
        return checkoutError(
          429,
          "Too many unpaid orders from your network. Complete or cancel an existing checkout, or try again in a few minutes.",
          "TOO_MANY_PENDING"
        );
      }
    }

    const storeSettings = await getStoreSettings();
    let currency: string;
    try {
      currency = normalizeCurrency(storeSettings?.currency || "USD");
    } catch {
      return checkoutError(500, "The store currency is not supported for payments");
    }

    let shippingCountry: string | undefined = shippingAddress?.country;
    if (dbUserId && (shippingAddressId || billingAddressId)) {
      const addressIds = [shippingAddressId, billingAddressId].filter((id): id is string => Boolean(id));
      const ownedAddresses = await db.address.findMany({
        where: { id: { in: addressIds }, userId: dbUserId },
        select: { id: true, country: true },
      });
      if (ownedAddresses.length !== new Set(addressIds).size) {
        return checkoutError(403, "One or more selected addresses are not yours", "INVALID_INPUT");
      }
      if (shippingAddressId) {
        shippingCountry = ownedAddresses.find((address) => address.id === shippingAddressId)?.country;
      }
    }

    const enabledCountries = storeSettings?.enabledCountries ?? [];
    if (enabledCountries.length > 0 && (shippingAddress || shippingAddressId)
      && !isCountryEnabled(shippingCountry, enabledCountries)) {
      return checkoutError(400, "We do not ship to the selected country", "COUNTRY_NOT_ENABLED");
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
        return checkoutError(400, "One or more products are unavailable", "PRODUCT_UNAVAILABLE");
      }
      if (product.stock < quantity) {
        return checkoutError(409, `Insufficient stock for ${product.name}`, "INSUFFICIENT_STOCK", { productId });
      }

      const price = roundMoney(product.price, currency);
      subtotal = subtotal.add(price.mul(quantity));
      orderItemsData.push({ productId, quantity, price });
    }

    subtotal = roundMoney(subtotal, currency);
    let discount: DiscountRecord | null = null;

    if (discountCode) {
      const found = await db.discountCode.findUnique({ where: { code: discountCode.toUpperCase() } });
      if (!found) {
        return checkoutError(400, "Invalid or expired discount code", "INVALID_DISCOUNT");
      }
      const discountError = discountAvailabilityError(found, new Date(), subtotal.toNumber());
      if (discountError) return checkoutError(400, discountError, "INVALID_DISCOUNT");
      discount = { type: found.type, value: found.value };
    }

    const configuredTaxRate = new Prisma.Decimal(storeSettings?.taxRate ?? 0);
    const configuredShipping = new Prisma.Decimal(storeSettings?.shippingCost ?? 0);
    // Same rule as the storefront estimate: null disables free shipping, 0 makes it always free.
    const thresholdSetting = resolveFreeShippingThreshold(storeSettings);
    const freeShippingThreshold = thresholdSetting === null ? null : new Prisma.Decimal(thresholdSetting);
    if (
      ![configuredTaxRate, configuredShipping].every((value) => value.isFinite())
      || (freeShippingThreshold !== null && (!freeShippingThreshold.isFinite() || freeShippingThreshold.isNegative()))
      || configuredTaxRate.isNegative()
      || configuredTaxRate.gt(100)
      || configuredShipping.isNegative()
    ) {
      return checkoutError(500, "Store payment settings are invalid");
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

    // Stripe rejects card charges below a per-currency minimum. Fail before
    // any stock is reserved.
    if (isBelowStripeMinimum(finalTotalMinor, currency)) {
      return belowMinimumResponse(currency, stripeMinimumChargeMinor(currency));
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl || !/^https?:\/\//i.test(appUrl)) {
      return checkoutError(500, "NEXT_PUBLIC_APP_URL is not configured correctly");
    }

    const guestTokenExpiry = dbUserId ? null : createGuestOrderTokenExpiry();
    const createOrderTransaction = (orderNumber: string) => db.$transaction(async (tx) => {
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

      const created = await tx.order.create({
        data: {
          orderNumber,
          checkoutRequestId: requestId,
          checkoutIpHash,
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
    for (let attempt = 1; ; attempt += 1) {
      try {
        // The number comes from an atomic counter outside the order
        // transaction, so concurrent checkouts never receive the same one.
        const orderNumber = await withDbRetry(() => allocateOrderNumber(db));
        order = await withDbRetry(() => createOrderTransaction(orderNumber));
        break;
      } catch (error: any) {
        if (isOrderNumberConflict(error) && attempt < MAX_ORDER_NUMBER_ATTEMPTS) {
          // E.g. orders created by an older release; move the counter past them.
          await resyncOrderNumberCounter(db);
          continue;
        }
        if (String(error?.message || "").startsWith("INSUFFICIENT_STOCK:")) {
          return checkoutError(409, "Insufficient stock for one or more products", "INSUFFICIENT_STOCK");
        }
        if (error?.code === "P2002" && !isOrderNumberConflict(error)) {
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
    }
    createdOrderId = order.id;

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
          metadata: {
            orderId: order.id,
            checkoutRequestId: requestId,
            deploymentId: getStripeDeploymentId(),
            ...(dbUserId && { userId: dbUserId }),
          },
          payment_intent_data: {
            metadata: {
              orderId: order.id,
              checkoutRequestId: requestId,
              deploymentId: getStripeDeploymentId(),
              ...(dbUserId && { userId: dbUserId }),
            },
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
      if (!stripeSession) {
        try {
          await handleOrderCancellation(order.id);
        } catch (cleanupError: any) {
          logger.error("Failed to release checkout reservation", { orderId: order.id, code: cleanupError?.code });
        }
      }

      if (!stripeSession && stripeError?.code === "amount_too_small") {
        return belowMinimumResponse(currency, stripeMinimumChargeMinor(currency));
      }
      return checkoutError(502, "Payment initialization failed", "PAYMENT_INIT_FAILED");
    }

    if (!stripeSession.url) {
      return checkoutError(502, "Stripe did not return a checkout URL", "PAYMENT_INIT_FAILED");
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

    return checkoutError(
      500,
      error?.message === "CHECKOUT_TOTAL_MISMATCH" ? "Unable to calculate checkout total" : "Failed to create order"
    );
  }
}
