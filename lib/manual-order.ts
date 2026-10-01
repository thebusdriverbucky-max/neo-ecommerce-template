import { createHash, randomBytes } from "node:crypto";
import { calculateOrderMoney, fromMinorUnits, toMinorUnits } from "./order-money";
import {
  assertOrderTransition,
  OrderStatusValue,
  reservationExpiry,
  transitionReleasesStock,
  transitionRequiresReservation,
} from "./order-lifecycle";

export class OrderConflictError extends Error {}
export class OrderInputError extends Error {}
export class OrderConfigurationError extends Error {}

type OrderActor = { userId: string | null; role?: string | null; guestEmail?: string | null };
type OrderItemInput = { productId: string; quantity: number };

function normalizedEmail(value?: string | null): string | null {
  return value?.trim().toLowerCase() || null;
}

function requiredPaymentSettings(settings: any) {
  const snapshot = {
    paymentIban: settings?.paymentIban?.trim(),
    paymentBankName: settings?.paymentBankName?.trim(),
    paymentAccountName: settings?.paymentAccountName?.trim(),
    paymentDetails: settings?.paymentDetails?.trim(),
  };
  if (Object.values(snapshot).some((value) => !value)) {
    throw new OrderConfigurationError("Bank transfer checkout is unavailable until all payment details are configured");
  }
  return snapshot as Record<keyof typeof snapshot, string>;
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

export async function createManualOrder(db: any, input: {
  actor: OrderActor;
  idempotencyKey: string;
  items: OrderItemInput[];
  shippingAddress?: Record<string, unknown>;
  shippingAddressId?: string;
  billingAddressId?: string;
  discountCode?: string;
  now?: Date;
}) {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(input.idempotencyKey)) throw new OrderInputError("A valid Idempotency-Key is required");
  const guestEmail = normalizedEmail(input.actor.guestEmail);
  if (!input.actor.userId && !guestEmail) throw new OrderInputError("Email is required for guest checkout");
  const items = aggregateOrderItems(input.items);
  const now = input.now || new Date();
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

    const settings = await tx.storeSettings.findFirst();
    const payment = requiredPaymentSettings(settings);

    if ((input.shippingAddressId || input.billingAddressId) && !input.actor.userId) {
      throw new OrderInputError("Guests must provide a new address");
    }
    const addressIds = [input.shippingAddressId, input.billingAddressId].filter(Boolean) as string[];
    if (addressIds.length) {
      const owned = await tx.address.count({ where: { id: { in: addressIds }, userId: input.actor.userId } });
      if (owned !== new Set(addressIds).size) throw new OrderInputError("Address does not belong to the signed-in customer");
    }
    if (!input.shippingAddress && !input.shippingAddressId) throw new OrderInputError("Shipping address is required");

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
      if (!discount || !discount.isActive || (discount.expiresAt && discount.expiresAt <= now)) {
        throw new OrderInputError("Discount code is invalid or expired");
      }
      const preliminarySubtotal = lines.reduce((sum, line) => sum + toMinorUnits(line.unitPrice) * line.quantity, 0);
      if (discount.minAmount != null && preliminarySubtotal < toMinorUnits(String(discount.minAmount))) {
        throw new OrderInputError("Order does not meet the discount minimum");
      }
      if (discount.type === "PERCENT" && (Number(discount.value) < 0 || Number(discount.value) > 100)) {
        throw new OrderInputError("Discount configuration is invalid");
      }
    }

    const subtotalMinor = lines.reduce((sum, line) => sum + toMinorUnits(line.unitPrice) * line.quantity, 0);
    const freeShippingMinor = toMinorUnits(String(settings.freeShippingThreshold ?? 0));
    const shippingMinor = subtotalMinor >= freeShippingMinor ? 0 : toMinorUnits(String(settings.shippingCost ?? 0));
    let effectiveDiscount = discount ? { type: discount.type, value: discount.value } : null;
    let money = calculateOrderMoney({ lines, discount: effectiveDiscount, taxRatePercent: Number(settings.taxRate ?? 0), shippingMinor });
    if (discount?.maxDiscount != null && money.discountMinor > toMinorUnits(String(discount.maxDiscount))) {
      effectiveDiscount = { type: "FIXED", value: String(discount.maxDiscount) };
      money = calculateOrderMoney({ lines, discount: effectiveDiscount, taxRatePercent: Number(settings.taxRate ?? 0), shippingMinor });
    }

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
    const result = await tx.product.updateMany({
      where: { id: item.productId, isArchived: false, stock: { gte: item.quantity } },
      data: { stock: { decrement: item.quantity } },
    });
    if (result.count !== 1) throw new OrderConflictError("Stock is unavailable; support must resolve the late payment manually");
  }
}

export async function transitionManualOrder(db: any, input: {
  orderId: string;
  nextStatus: OrderStatusValue;
  adminUserId: string;
  trackingNumber?: string | null;
  expiration?: boolean;
  recoverExpired?: boolean;
  now?: Date;
}) {
  const now = input.now || new Date();
  return db.$transaction(async (tx: any) => {
    const order = await tx.order.findUnique({ where: { id: input.orderId }, include: { items: true, user: true } });
    if (!order) throw new OrderInputError("Order not found");
    if (!order.reservationExpiresAt || !order.paymentIban) {
      throw new OrderInputError("This is not a manual bank-transfer order");
    }
    const current = order.status as OrderStatusValue;
    const isRecovery = current === "CANCELLED" && input.nextStatus === "PENDING" && !!order.reservationExpiredAt && input.recoverExpired;
    if (!isRecovery) assertOrderTransition(current, input.nextStatus);
    if (current === "PENDING" && input.nextStatus === "CONFIRMED" && (!order.reservationExpiresAt || order.reservationExpiresAt <= now)) {
      throw new OrderConflictError("Reservation expired; expire and recover the order before confirmation");
    }
    if (isRecovery) {
      await reserveOrderItems(tx, order.items);
      if (order.discountCode && order.discountReleasedAt) {
        const discount = await tx.discountCode.findUnique({ where: { code: order.discountCode } });
        if (!discount) throw new OrderConflictError("The original discount no longer exists; support must resolve this payment manually");
        const claimed = await tx.discountCode.updateMany({
          where: { id: discount.id, ...(discount.usageLimit == null ? {} : { used: { lt: discount.usageLimit } }) },
          data: { used: { increment: 1 } },
        });
        if (claimed.count !== 1) throw new OrderConflictError("The original discount limit is exhausted; support must resolve this payment manually");
      }
    }

    const release = transitionReleasesStock(current, input.nextStatus) && !order.stockReleasedAt;
    const releaseDiscount = current === "PENDING" && input.nextStatus === "CANCELLED" && !!order.discountCode && !order.discountReleasedAt;
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
        ...(isRecovery ? { stockReleasedAt: null, discountReleasedAt: null, reservationExpiredAt: null, reservationExpiresAt: reservationExpiry(now) } : {}),
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
    return tx.order.findUnique({ where: { id: order.id }, include: { user: true, items: { include: { product: true } } } });
  });
}

export async function expirePendingOrders(db: any, now = new Date(), limit = 100): Promise<number> {
  const expired = await db.order.findMany({
    where: { status: "PENDING", reservationExpiresAt: { lte: now }, stockReleasedAt: null },
    select: { id: true },
    take: limit,
    orderBy: { reservationExpiresAt: "asc" },
  });
  let count = 0;
  for (const order of expired) {
    try {
      await transitionManualOrder(db, { orderId: order.id, nextStatus: "CANCELLED", adminUserId: "cron", expiration: true, now });
      count += 1;
    } catch (error) {
      if (!(error instanceof OrderConflictError)) throw error;
    }
  }
  return count;
}
