export const ORDER_RESERVATION_DAYS = 7;

export const ORDER_STATUSES = [
  "PENDING", "CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED", "PARTIALLY_REFUNDED", "REFUNDED",
] as const;
export type OrderStatusValue = (typeof ORDER_STATUSES)[number];

// Fulfilment only moves forward, and optional steps can be skipped (a store
// may go straight from Confirmed to Shipped, or to Delivered for pickup).
// CANCELLED closes an order that was never paid; a paid order is closed as
// REFUNDED once the bank transfer has been returned outside the app.
const TRANSITIONS: Record<OrderStatusValue, readonly OrderStatusValue[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "SHIPPED", "DELIVERED", "REFUNDED"],
  PROCESSING: ["SHIPPED", "DELIVERED", "REFUNDED"],
  SHIPPED: ["DELIVERED", "REFUNDED"],
  DELIVERED: ["REFUNDED"],
  CANCELLED: [],
  PARTIALLY_REFUNDED: ["PROCESSING", "SHIPPED", "DELIVERED", "REFUNDED"],
  REFUNDED: [],
};

// Paid but not handed to the carrier: a refund may return the items to stock.
const RESTOCKABLE_ON_REFUND: readonly OrderStatusValue[] = ["CONFIRMED", "PROCESSING"];

export function isOrderStatus(value: unknown): value is OrderStatusValue {
  return typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: OrderStatusValue, to: OrderStatusValue): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertOrderTransition(from: OrderStatusValue, to: OrderStatusValue): void {
  if (!canTransition(from, to)) throw new Error(`Invalid order transition: ${from} -> ${to}`);
}

export function transitionRequiresReservation(from: OrderStatusValue, to: OrderStatusValue): boolean {
  return from === "CANCELLED" && to === "PENDING";
}

export function canRestockOnRefund(from: OrderStatusValue): boolean {
  return RESTOCKABLE_ON_REFUND.includes(from);
}

/**
 * Cancelling an unpaid order always returns its reserved stock. A refund only
 * does so when the admin asks for it and the items were never shipped.
 */
export function transitionReleasesStock(from: OrderStatusValue, to: OrderStatusValue, restock = false): boolean {
  if (from === "PENDING" && to === "CANCELLED") return true;
  return to === "REFUNDED" && restock && canRestockOnRefund(from);
}

export function reservationExpiry(now = new Date()): Date {
  return new Date(now.getTime() + ORDER_RESERVATION_DAYS * 24 * 60 * 60 * 1000);
}
