import { createHash, randomBytes } from "node:crypto";
import { calculateOrderMoney, fromMinorUnits, toMinorUnits } from "./order-money";
import { discountAvailabilityError } from "./discounts";
import { isCountryEnabled, resolveFreeShippingThreshold } from "./shipping";
import { logger } from "./logger";
import {
  assertOrderTransition,
  canRestockOnRefund,
  OrderStatusValue,
  reservationExpiry,
  transitionReleasesStock,
} from "./order-lifecycle";

export class OrderConflictError extends Error {}
export class OrderInputError extends Error {}
export class OrderConfigurationError extends Error {}
export class OrderLimitError extends Error {}

// Unpaid orders hold stock for days, so they are capped per customer and,
// on Vercel, per hashed client IP. Works without Redis.
export const MAX_OPEN_RESERVATIONS_PER_CUSTOMER = 3;
export const MAX_OPEN_RESERVATIONS_PER_CLIENT = 5;

// Same order as lib/store-settings.ts (kept inline so this module has no
// database import): older databases can hold more than one settings row.
const STORE_SETTINGS_ORDER = [{ createdAt: "asc" }, { id: "asc" }];

// Order totals above this cannot be represented (see lib/order-money.ts), so a
// higher free-shipping threshold can never be reached.
const MAX_ORDER_AMOUNT = 1_000_000;

type OrderActor = { userId: string | null; role?: string | null; guestEmail?: string | null };
type OrderItemInput = { productId: string; quantity: number };
export type StockReleaseHook = (productIds: string[]) => Promise<void>;

function normalizedEmail(value?: string | null): string | null {
  return value?.trim().toLowerCase() || null;
}

function paymentSettingsSnapshot(settings: any) {
  return {
    paymentIban: settings?.paymentIban?.trim() || null,
    paymentBankName: settings?.paymentBankName?.trim() || null,
    paymentAccountName: settings?.paymentAccountName?.trim() || null,
    paymentDetails: settings?.paymentDetails?.trim() || null,
  };
}

export function aggregateOrderItems(items: OrderItemInput[]): OrderItemInput[] {
  const aggregated = new Map<string, number>();
  for (const item of items) {
    if (!item.productId || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100) {
      throw new OrderInputError("Invalid order item");
    }
    const quantity = (aggregated.get(item.productId) || 0) + item.quantity;
    if (quantity > 100) throw new OrderInputError("Maximum quantity per product is 100");
    aggregated.set(item.productId, quantity);
  }
  if (!aggregated.size || aggregated.size > 50) throw new OrderInputError("Order must contain 1 to 50 products");
  return [...aggregated].map(([productId, quantity]) => ({ productId, quantity }));
}

function stableFingerprint(input: unknown): string {
  const normalize = (value: any): any => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
    }
    return value;
  };
  return createHash("sha256").update(JSON.stringify(normalize(input))).digest("hex");
}

function scopedRequestId(key: string, actor: OrderActor): string {
  const scope = actor.userId || `guest:${normalizedEmail(actor.guestEmail)}`;
  return createHash("sha256").update(`${scope}:${key}`).digest("hex");
}

function publicOrderResult(order: any, replayed = false) {
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    total: Number(order.total),
    currency: order.currency,
    paymentIban: order.paymentIban,
    paymentBankName: order.paymentBankName,
    paymentAccountName: order.paymentAccountName,
    paymentDetails: order.paymentDetails,
    reservationExpiresAt: order.reservationExpiresAt,
    purchasedItems: order.items?.map((item: any) => ({ productId: item.productId, quantity: item.quantity })) || [],
    replayed,
  };
}

/** Shipping in minor units: same rule as the storefront estimate (lib/discounts.ts). */
function shippingMinorUnits(settings: any, subtotalMinor: number): number {
  try {
    const threshold = resolveFreeShippingThreshold(settings);
    const freeShipping = threshold !== null && Number.isFinite(threshold) && threshold <= MAX_ORDER_AMOUNT
      && subtotalMinor >= toMinorUnits(String(threshold));
    return freeShipping ? 0 : toMinorUnits(String(settings.shippingCost ?? 0));
  } catch {
    throw new OrderConfigurationError("Store shipping settings are invalid; review them in the admin settings");
  }
}

export async function createManualOrder(db: any, input: {
  actor: OrderActor;
  idempotencyKey: string;
  items: OrderItemInput[];
  shippingAddress?: Record<string, unknown>;
  shippingAddressId?: string;
  billingAddressId?: string;
  discountCode?: string;
  /** Keyed hash of the trusted client IP (lib/request-identity.ts), if known. */
  checkoutIpHash?: string | null;
  now?: Date;
}) {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(input.idempotencyKey)) throw new OrderInputError("A valid Idempotency-Key is required");
  const guestEmail = normalizedEmail(input.actor.guestEmail);
  if (!input.actor.userId && !guestEmail) throw new OrderInputError("Email is required for guest checkout");
  const items = aggregateOrderItems(input.items);
  const now = input.now || new Date();
  const checkoutIpHash = input.checkoutIpHash || null;
  const checkoutRequestId = scopedRequestId(input.idempotencyKey, { ...input.actor, guestEmail });
  const requestFingerprint = stableFingerprint({
    actor: input.actor.userId || guestEmail,
    items: [...items].sort((a, b) => a.productId.localeCompare(b.productId)),
    shippingAddress: input.shippingAddress,
    shippingAddressId: input.shippingAddressId,
    billingAddressId: input.billingAddressId,
    discountCode: input.discountCode?.trim().toUpperCase() || null,
  });

  const run = async () => db.$transaction(async (tx: any) => {
    const existing = await tx.order.findUnique({
      where: { checkoutRequestId },
      include: { items: true },
    });
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) throw new OrderConflictError("Idempotency key was already used for another request");
      return publicOrderResult(existing, true);
    }

    // Only reservations that still hold stock count; expired ones are released
    // by the cleanup that runs before checkout.
    const openReservation = { status: "PENDING", stockReleasedAt: null, reservationExpiresAt: { gt: now } };
    const customerOpen = await tx.order.count({
      where: { ...openReservation, ...(input.actor.userId ? { userId: input.actor.userId } : { guestEmail }) },
    });
    if (customerOpen >= MAX_OPEN_RESERVATIONS_PER_CUSTOMER) {
      throw new OrderLimitError("You already have several unpaid orders. Pay for one of them or contact the store before placing another.");
    }
    if (checkoutIpHash) {
      const clientOpen = await tx.order.count({ where: { ...openReservation, checkoutIpHash } });
      if (clientOpen >= MAX_OPEN_RESERVATIONS_PER_CLIENT) {
        throw new OrderLimitError("Too many unpaid orders from your network. Pay for an existing order or try again later.");
      }
    }

    const settings = await tx.storeSettings.findFirst({ orderBy: STORE_SETTINGS_ORDER });
    if (!settings) throw new OrderConfigurationError("Store settings are not configured");
    const payment = paymentSettingsSnapshot(settings);

    if ((input.shippingAddressId || input.billingAddressId) && !input.actor.userId) {
      throw new OrderInputError("Guests must provide a new address");
    }
    const addressIds = [input.shippingAddressId, input.billingAddressId].filter(Boolean) as string[];
    let shippingCountry = typeof input.shippingAddress?.country === "string" ? input.shippingAddress.country : null;
    if (addressIds.length) {
      const owned = await tx.address.findMany({
        where: { id: { in: addressIds }, userId: input.actor.userId },
        select: { id: true, country: true },
      });
      if (owned.length !== new Set(addressIds).size) throw new OrderInputError("Address does not belong to the signed-in customer");
      if (input.shippingAddressId) {
        shippingCountry = owned.find((address: any) => address.id === input.shippingAddressId)?.country ?? null;
      }
    }
    if (!input.shippingAddress && !input.shippingAddressId) throw new OrderInputError("Shipping address is required");
    const enabledCountries: string[] = settings.enabledCountries ?? [];
    if (enabledCountries.length > 0 && !isCountryEnabled(shippingCountry, enabledCountries)) {
      throw new OrderInputError("We do not ship to the selected country");
    }

    const products = await tx.product.findMany({ where: { id: { in: items.map((item) => item.productId) } } });
    if (products.length !== items.length) throw new OrderInputError("One or more products no longer exist");
    const lines = items.map((item) => {
      const product = products.find((candidate: any) => candidate.id === item.productId);
      if (!product || product.isArchived) throw new OrderInputError("Archived products cannot be ordered");
      if (product.currency && product.currency !== settings.currency) {
        throw new OrderConfigurationError("Product and store currencies do not match; prices must be reviewed before checkout");
      }
      return { ...item, name: product.name, unitPrice: String(product.price) };
    });

    let discount: any = null;
    const discountCode = input.discountCode?.trim().toUpperCase();
    if (discountCode) {
      discount = await tx.discountCode.findUnique({ where: { code: discountCode } });
      if (!discount) {
        throw new OrderInputError("Discount code is invalid or expired");
      }
      const preliminarySubtotal = lines.reduce((sum, line) => sum + toMinorUnits(line.unitPrice) * line.quantity, 0);
      const discountError = discountAvailabilityError(discount, now, fromMinorUnits(preliminarySubtotal));
      if (discountError) throw new OrderInputError(discountError);
    }

    // Free shipping is decided on the subtotal before any discount.
    const subtotalMinor = lines.reduce((sum, line) => sum + toMinorUnits(line.unitPrice) * line.quantity, 0);
    const shippingMinor = shippingMinorUnits(settings, subtotalMinor);
    const effectiveDiscount = discount ? {
      type: discount.type, value: discount.value,
      maxDiscount: discount.maxDiscount == null ? null : String(discount.maxDiscount),
    } : null;
    const money = calculateOrderMoney({ lines, discount: effectiveDiscount, taxRatePercent: Number(settings.taxRate ?? 0), shippingMinor });

    if (discount) {
      const claimed = await tx.discountCode.updateMany({
        where: {
          id: discount.id,
          isActive: true,
          ...(discount.usageLimit == null ? {} : { used: { lt: discount.usageLimit } }),
        },
        data: { used: { increment: 1 } },
      });
      if (claimed.count !== 1) throw new OrderConflictError("Discount usage limit has been reached");
    }

    for (const line of lines) {
      const reserved = await tx.product.updateMany({
        where: { id: line.productId, isArchived: false, stock: { gte: line.quantity } },
        data: { stock: { decrement: line.quantity } },
      });
      if (reserved.count !== 1) throw new OrderConflictError(`Insufficient stock for ${line.name}`);
    }

    let shippingAddressId = input.shippingAddressId || null;
    if (input.shippingAddress) {
      const address = await tx.address.create({ data: { ...input.shippingAddress, state: input.shippingAddress.state || "", userId: input.actor.userId || undefined } });
      shippingAddressId = address.id;
    }
    const orderNumber = `#${now.getUTCFullYear()}-${randomBytes(5).toString("hex").toUpperCase()}`;
    const order = await tx.order.create({
      data: {
        checkoutRequestId,
        requestFingerprint,
        checkoutIpHash,
        orderNumber,
        status: "PENDING",
        subtotal: fromMinorUnits(money.subtotalMinor),
        discountAmount: fromMinorUnits(money.discountMinor),
        discountCode: discountCode || null,
        tax: fromMinorUnits(money.taxMinor),
        shippingCost: fromMinorUnits(money.shippingMinor),
        total: fromMinorUnits(money.totalMinor),
        currency: settings.currency,
        ...payment,
        reservationExpiresAt: reservationExpiry(now),
        shippingAddressId,
        billingAddressId: input.billingAddressId || null,
        items: { create: lines.map((line) => ({ productId: line.productId, quantity: line.quantity, price: fromMinorUnits(toMinorUnits(line.unitPrice)) })) },
        ...(input.actor.userId ? { userId: input.actor.userId } : { guestEmail }),
      },
      include: { items: true },
    });
    return publicOrderResult(order);
  });

  try {
    return await run();
  } catch (error: any) {
    if (error?.code !== "P2002") throw error;
    const existing = await db.order.findUnique({ where: { checkoutRequestId }, include: { items: true } });
    if (!existing || existing.requestFingerprint !== requestFingerprint) throw new OrderConflictError("Idempotency key conflict");
    return publicOrderResult(existing, true);
  }
}

async function reserveOrderItems(tx: any, items: any[]): Promise<void> {
  for (const item of items) {
    // A paid order is honoured even if the product was archived meanwhile, as
    // long as the stock is still there.
    const result = await tx.product.updateMany({
      where: { id: item.productId, stock: { gte: item.quantity } },
      data: { stock: { decrement: item.quantity } },
    });
    if (result.count !== 1) {
      const name = item.product?.name ? `"${item.product.name}"` : "an item";
      throw new OrderConflictError(`Not enough stock to reserve ${name} again. Increase the stock first, or refund the payment.`);
    }
  }
}

/**
 * Re-counts the discount an expired order gave back. A late payment was made
 * for the quoted total, so it is honoured even when the code has run out or
 * was deleted; re-opening an unpaid order keeps the usage limit strict.
 */
async function reclaimDiscount(tx: any, code: string, honourQuote: boolean): Promise<void> {
  const discount = await tx.discountCode.findUnique({ where: { code } });
  if (!discount) {
    if (honourQuote) return;
    throw new OrderConflictError("The original discount no longer exists; support must resolve this order manually");
  }
  const claimed = await tx.discountCode.updateMany({
    where: { id: discount.id, ...(honourQuote || discount.usageLimit == null ? {} : { used: { lt: discount.usageLimit } }) },
    data: { used: { increment: 1 } },
  });
  if (claimed.count !== 1) throw new OrderConflictError("The original discount limit is exhausted; support must resolve this order manually");
}

const ORDER_DETAIL_INCLUDE = {
  user: { select: { id: true, name: true, email: true } },
  shippingAddress: true,
  items: { include: { product: { select: { id: true, name: true, image: true } } } },
};

// Checkout bookkeeping that never leaves the server.
export const INTERNAL_ORDER_FIELDS = { checkoutRequestId: true, requestFingerprint: true, checkoutIpHash: true } as const;

async function runStockReleaseHook(hook: StockReleaseHook | undefined, orderId: string, productIds: string[]) {
  if (!hook || productIds.length === 0) return;
  try {
    await hook(productIds);
  } catch (error) {
    logger.warn("Stock release follow-up failed", { orderId, name: error instanceof Error ? error.name : undefined });
  }
}

/**
 * Moves a bank-transfer order to a new status.
 * - PENDING -> CONFIRMED records the payment, even after the reservation
 *   period ended, as long as the stock is still held.
 * - An order cancelled by expiry can be confirmed directly when a late
 *   transfer arrives: stock and discount are reserved again atomically.
 *   recoverExpired re-opens it as PENDING instead (older admin clients).
 * - A refund returns stock only with `restock` and before shipping.
 */
export async function transitionManualOrder(db: any, input: {
  orderId: string;
  nextStatus: OrderStatusValue;
  adminUserId: string;
  trackingNumber?: string | null;
  expiration?: boolean;
  recoverExpired?: boolean;
  restock?: boolean;
  /** Runs after commit with the products whose stock was returned. */
  onStockReleased?: StockReleaseHook;
  now?: Date;
}) {
  const now = input.now || new Date();
  const { order, releasedProductIds } = await db.$transaction(async (tx: any) => {
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: { items: { include: { product: { select: { name: true } } } } },
    });
    if (!order) throw new OrderInputError("Order not found");
    if (!order.reservationExpiresAt) {
      throw new OrderInputError("This is not a manual bank-transfer order");
    }
    const current = order.status as OrderStatusValue;
    const expiredReservation = current === "CANCELLED" && !!order.reservationExpiredAt;
    const isRecovery = expiredReservation && input.nextStatus === "PENDING" && !!input.recoverExpired;
    const isLatePayment = expiredReservation && input.nextStatus === "CONFIRMED";
    if (!isRecovery && !isLatePayment) assertOrderTransition(current, input.nextStatus);
    if (input.restock && (input.nextStatus !== "REFUNDED" || !canRestockOnRefund(current))) {
      throw new OrderConflictError("Only a refund of an order that was not shipped yet can return the items to stock");
    }
    if (isRecovery || isLatePayment) {
      await reserveOrderItems(tx, order.items);
      if (order.discountCode && order.discountReleasedAt) {
        await reclaimDiscount(tx, order.discountCode, isLatePayment);
      }
    }

    const release = transitionReleasesStock(current, input.nextStatus, input.restock) && !order.stockReleasedAt;
    const releaseDiscount = current === "PENDING" && input.nextStatus === "CANCELLED" && !!order.discountCode && !order.discountReleasedAt;
    const reReserved = isRecovery || isLatePayment;
    const updated = await tx.order.updateMany({
      where: {
        id: order.id,
        status: current,
        ...(release ? { stockReleasedAt: null } : {}),
        ...(releaseDiscount ? { discountReleasedAt: null } : {}),
      },
      data: {
        status: input.nextStatus,
        ...(input.trackingNumber !== undefined ? { trackingNumber: input.trackingNumber || null } : {}),
        ...(release ? { stockReleasedAt: now } : {}),
        ...(releaseDiscount ? { discountReleasedAt: now } : {}),
        ...(input.expiration ? { reservationExpiredAt: now } : {}),
        // The IP hash only exists to cap open reservations.
        ...(current === "PENDING" ? { checkoutIpHash: null } : {}),
        ...(reReserved ? { stockReleasedAt: null, discountReleasedAt: null, reservationExpiredAt: null } : {}),
        ...(isRecovery ? { reservationExpiresAt: reservationExpiry(now) } : {}),
        ...(input.nextStatus === "CONFIRMED" ? { paymentConfirmedAt: now, paymentConfirmedBy: input.adminUserId } : {}),
      },
    });
    if (updated.count !== 1) throw new OrderConflictError("Order was changed by another request");
    if (releaseDiscount) {
      await tx.discountCode.updateMany({
        where: { code: order.discountCode, used: { gt: 0 } },
        data: { used: { decrement: 1 } },
      });
    }
    if (release) {
      for (const item of order.items) {
        await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
      }
    }
    return {
      order: await tx.order.findUnique({ where: { id: order.id }, omit: INTERNAL_ORDER_FIELDS, include: ORDER_DETAIL_INCLUDE }),
      releasedProductIds: release ? order.items.map((item: any) => item.productId) : [],
    };
  });
  await runStockReleaseHook(input.onStockReleased, input.orderId, releasedProductIds);
  return order;
}

/** Sets or clears the tracking number without touching the status. */
export async function updateOrderTracking(db: any, input: { orderId: string; trackingNumber: string | null }) {
  const updated = await db.order.updateMany({
    where: { id: input.orderId, reservationExpiresAt: { not: null } },
    data: { trackingNumber: input.trackingNumber || null },
  });
  if (updated.count !== 1) throw new OrderInputError("Order not found");
  return db.order.findUnique({ where: { id: input.orderId }, omit: INTERNAL_ORDER_FIELDS, include: ORDER_DETAIL_INCLUDE });
}

export async function expirePendingOrders(
  db: any,
  now = new Date(),
  limit = 100,
  options: { onStockReleased?: StockReleaseHook } = {},
): Promise<number> {
  const expired = await db.order.findMany({
    where: { status: "PENDING", reservationExpiresAt: { lte: now }, stockReleasedAt: null },
    select: { id: true },
    take: limit,
    orderBy: { reservationExpiresAt: "asc" },
  });
  let count = 0;
  for (const order of expired) {
    try {
      await transitionManualOrder(db, {
        orderId: order.id,
        nextStatus: "CANCELLED",
        adminUserId: "cron",
        expiration: true,
        onStockReleased: options.onStockReleased,
        now,
      });
      count += 1;
    } catch (error) {
      // One broken order must never block checkout or the catalog; the next
      // cleanup retries it. A conflict means another request already acted.
      if (!(error instanceof OrderConflictError)) {
        logger.warn("Expired reservation could not be released", {
          orderId: order.id,
          name: error instanceof Error ? error.name : undefined,
        });
      }
    }
  }
  return count;
}
