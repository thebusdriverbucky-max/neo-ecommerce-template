// Pure helpers for the admin orders screen and GET /api/orders. Must stay free
// of server-only imports: the admin page and the API route both use it.
import { canTransitionOrder } from "@/lib/order-state";

export const ORDER_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
] as const;

export type AdminOrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<AdminOrderStatus, string> = {
  PENDING: "Pending payment",
  CONFIRMED: "Confirmed",
  PROCESSING: "Processing",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  PARTIALLY_REFUNDED: "Partially refunded",
  REFUNDED: "Refunded",
};

export const MAX_TRACKING_NUMBER_LENGTH = 100;
export const MAX_ORDER_PAGE_SIZE = 100;
export const DEFAULT_ORDER_PAGE_SIZE = 25;

export function isOrderStatus(value: unknown): value is AdminOrderStatus {
  return typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value);
}

export function orderStatusLabel(status: string): string {
  return isOrderStatus(status) ? ORDER_STATUS_LABELS[status] : status;
}

/** What each status means, shown to the admin next to the status picker. */
export const ORDER_STATUS_HINTS: Record<AdminOrderStatus, string> = {
  PENDING: "Waiting for the customer to pay on Stripe. The stock is reserved, and the order cancels itself if the payment page expires.",
  CONFIRMED: "Paid. Get the order ready to ship.",
  PROCESSING: "Optional step: you are packing the order.",
  SHIPPED: "Handed to the carrier. The customer gets an email with the tracking number.",
  DELIVERED: "The customer has the order. They get a delivery email.",
  CANCELLED: "Closed without a payment. The reserved stock was returned.",
  PARTIALLY_REFUNDED: "Part of the payment was returned to the customer. The remaining items can still be shipped.",
  REFUNDED: "The whole payment was returned to the customer.",
};

export function orderStatusHint(status: string): string {
  return isOrderStatus(status) ? ORDER_STATUS_HINTS[status] : "";
}

/**
 * Fulfilment statuses the admin can pick: the current one plus the forward
 * transitions the API accepts. Cancelling and refunding are separate actions
 * (see orderPaymentActions), never a status choice.
 */
export function allowedStatusOptions(current: string): Array<{ value: string; label: string }> {
  if (!isOrderStatus(current)) return [{ value: current, label: current }];
  const targets = ORDER_STATUSES.filter(
    (next) => next !== current && next !== "CANCELLED" && canTransitionOrder(current, next, true),
  );
  return [current, ...targets].map((value) => ({ value, label: ORDER_STATUS_LABELS[value] }));
}

type PaymentFields = {
  status: string;
  total: string | number | { toString(): string };
  refundedAmount?: string | number | { toString(): string } | null;
  stripePaymentIntentId?: string | null;
  stripeCheckoutSessionId?: string | null;
};

const REFUNDABLE_STATUSES = ["CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "PARTIALLY_REFUNDED"];
const UNSHIPPED_PAID_STATUSES = ["CONFIRMED", "PROCESSING"];

/** A confirmed order that never went through Stripe (100% discount). */
export function isFreeOrder(order: PaymentFields): boolean {
  return !order.stripePaymentIntentId && !order.stripeCheckoutSessionId && Number(order.total.toString()) === 0;
}

export type OrderPaymentActions = {
  /** Unpaid or free order: cancelling returns the stock and takes no money. */
  canCancel: boolean;
  /** Amount still refundable through Stripe, or null when nothing is. */
  refundableAmount: number | null;
  /** The items were not shipped, so a full refund may return them to stock. */
  canRestockOnRefund: boolean;
};

/**
 * Cancel and refund actions offered for an order. The API enforces the same
 * rules; Stripe stays the source of truth for the refundable amount.
 */
export function orderPaymentActions(order: PaymentFields): OrderPaymentActions {
  const free = isFreeOrder(order);
  const canCancel = order.status === "PENDING" || (free && UNSHIPPED_PAID_STATUSES.includes(order.status));

  const remaining = Math.round((Number(order.total.toString()) - Number((order.refundedAmount ?? 0).toString())) * 100) / 100;
  const refundable = Boolean(order.stripePaymentIntentId) && REFUNDABLE_STATUSES.includes(order.status) && remaining > 0;

  return {
    canCancel,
    refundableAmount: refundable ? remaining : null,
    canRestockOnRefund: refundable && UNSHIPPED_PAID_STATUSES.includes(order.status),
  };
}

export type OrderPatchResult =
  | { ok: true; payload: { status?: string; trackingNumber?: string | null } }
  | { ok: false; error: string };

/**
 * Builds the PATCH /api/orders/[id] body from the dialog state, sending only
 * the fields that changed. A cleared tracking number is sent as null.
 */
export function buildOrderPatch(
  current: { status: string; trackingNumber?: string | null },
  next: { status: string; trackingNumber: string },
): OrderPatchResult {
  const payload: { status?: string; trackingNumber?: string | null } = {};
  if (next.status && next.status !== current.status) payload.status = next.status;

  const nextTracking = next.trackingNumber.trim();
  const currentTracking = (current.trackingNumber ?? "").trim();
  if (nextTracking.length > MAX_TRACKING_NUMBER_LENGTH) {
    return { ok: false, error: `Tracking number must be ${MAX_TRACKING_NUMBER_LENGTH} characters or fewer.` };
  }
  if (nextTracking !== currentTracking) payload.trackingNumber = nextTracking === "" ? null : nextTracking;

  if (Object.keys(payload).length === 0) return { ok: false, error: "No changes to save." };
  return { ok: true, payload };
}

export type OrderListQuery =
  | { ok: true; paginated: false; where: Record<string, unknown> }
  | { ok: true; paginated: true; page: number; pageSize: number; where: Record<string, unknown> }
  | { ok: false; error: string };

function positiveInt(value: string | null, fallback: number): number {
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

/** Parses ?page, ?pageSize, ?status and ?q for GET /api/orders. */
export function parseOrderListQuery(params: URLSearchParams): OrderListQuery {
  const where: Record<string, unknown> = {};

  const status = params.get("status")?.trim();
  if (status) {
    if (!isOrderStatus(status)) return { ok: false, error: "Invalid status filter" };
    where.status = status;
  }

  const q = params.get("q")?.trim().slice(0, 100);
  if (q) {
    where.OR = [
      { orderNumber: { contains: q, mode: "insensitive" } },
      { guestEmail: { contains: q, mode: "insensitive" } },
      { user: { is: { email: { contains: q, mode: "insensitive" } } } },
    ];
  }

  if (params.get("page") === null) return { ok: true, paginated: false, where };

  return {
    ok: true,
    paginated: true,
    page: positiveInt(params.get("page"), 1),
    pageSize: Math.min(positiveInt(params.get("pageSize"), DEFAULT_ORDER_PAGE_SIZE), MAX_ORDER_PAGE_SIZE),
    where,
  };
}
