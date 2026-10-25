// Pure helpers for the admin orders screen and GET /api/orders. Must stay free
// of server-only imports: the admin page and the API route both use it.
import { canRestockOnRefund, canTransition, isOrderStatus, ORDER_STATUSES, type OrderStatusValue } from "@/lib/order-lifecycle";

export { ORDER_STATUSES, isOrderStatus };
export type AdminOrderStatus = OrderStatusValue;

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

export const MAX_TRACKING_NUMBER_LENGTH = 200;
export const MAX_ORDER_PAGE_SIZE = 100;
export const DEFAULT_ORDER_PAGE_SIZE = 25;

export function orderStatusLabel(status: string): string {
  return isOrderStatus(status) ? ORDER_STATUS_LABELS[status] : status;
}

/** What each status means, shown to the admin next to the status picker. */
export const ORDER_STATUS_HINTS: Record<AdminOrderStatus, string> = {
  PENDING: "Waiting for the customer's bank transfer. The stock stays reserved until the date shown; after that the order is cancelled automatically.",
  CONFIRMED: "Payment received. Get the order ready to ship.",
  PROCESSING: "Optional step: you are packing the order.",
  SHIPPED: "Handed to the carrier. The customer gets an email with the tracking number.",
  DELIVERED: "The customer has the order. They get a delivery email.",
  CANCELLED: "Closed without a payment. The reserved stock was returned.",
  PARTIALLY_REFUNDED: "Part of the payment was returned to the customer. The remaining items can still be shipped.",
  REFUNDED: "The payment was returned to the customer outside the store, for example by bank transfer.",
};

export function orderStatusHint(status: string): string {
  return isOrderStatus(status) ? ORDER_STATUS_HINTS[status] : "";
}

// Payment steps (confirm, cancel, refund) are separate actions in the dialog.
const FULFILMENT_TARGETS: readonly AdminOrderStatus[] = ["PROCESSING", "SHIPPED", "DELIVERED"];

/**
 * Fulfilment statuses the admin can pick: the current one plus the forward
 * transitions the API accepts.
 */
export function allowedStatusOptions(current: string): Array<{ value: string; label: string }> {
  if (!isOrderStatus(current)) return [{ value: current, label: current }];
  const targets = FULFILMENT_TARGETS.filter((next) => next !== current && canTransition(current, next));
  return [current, ...targets].map((value) => ({ value, label: ORDER_STATUS_LABELS[value] }));
}

type PaymentFields = {
  status: string;
  reservationExpiresAt?: string | Date | null;
  reservationExpiredAt?: string | Date | null;
};

const REFUNDABLE_STATUSES: readonly string[] = ["CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "PARTIALLY_REFUNDED"];

export type OrderPaymentActions = {
  /** Unpaid order, or one cancelled by expiry, that a received transfer can confirm. */
  canConfirmPayment: boolean;
  /** The transfer arrived after the reservation period. */
  latePayment: boolean;
  /** Unpaid: cancelling returns the stock and takes no money. */
  canCancel: boolean;
  /** Paid: the money is returned outside the app, then the order is marked Refunded. */
  canRefund: boolean;
  /** The items were not shipped, so a refund may return them to stock. */
  canRestockOnRefund: boolean;
};

/** Payment actions offered for an order. The API enforces the same rules. */
export function orderPaymentActions(order: PaymentFields, now = new Date()): OrderPaymentActions {
  const expiredByCleanup = order.status === "CANCELLED" && Boolean(order.reservationExpiredAt);
  const overdue = order.status === "PENDING" && Boolean(order.reservationExpiresAt)
    && new Date(order.reservationExpiresAt as string | Date).getTime() <= now.getTime();
  return {
    canConfirmPayment: order.status === "PENDING" || expiredByCleanup,
    latePayment: expiredByCleanup || overdue,
    canCancel: order.status === "PENDING",
    canRefund: REFUNDABLE_STATUSES.includes(order.status),
    canRestockOnRefund: isOrderStatus(order.status) && canRestockOnRefund(order.status),
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
