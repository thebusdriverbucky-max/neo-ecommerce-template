export const ORDER_RESERVATION_DAYS = 7;

export const ORDER_STATUSES = [
  "PENDING", "CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED", "PARTIALLY_REFUNDED", "REFUNDED",
] as const;
export type OrderStatusValue = (typeof ORDER_STATUSES)[number];

const TRANSITIONS: Record<OrderStatusValue, readonly OrderStatusValue[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "CANCELLED", "REFUNDED"],
  PROCESSING: ["SHIPPED", "CANCELLED", "REFUNDED"],
  SHIPPED: ["DELIVERED", "REFUNDED"],
  DELIVERED: ["REFUNDED"],
  CANCELLED: [],
  PARTIALLY_REFUNDED: ["REFUNDED"],
  REFUNDED: [],
};

export function canTransition(from: OrderStatusValue, to: OrderStatusValue): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertOrderTransition(from: OrderStatusValue, to: OrderStatusValue): void {
  if (!canTransition(from, to)) throw new Error(`Invalid order transition: ${from} -> ${to}`);
}

export function transitionRequiresReservation(from: OrderStatusValue, to: OrderStatusValue): boolean {
  return from === "CANCELLED" && to === "PENDING";
}

export function transitionReleasesStock(from: OrderStatusValue, to: OrderStatusValue): boolean {
  return (from === "PENDING" && to === "CANCELLED") ||
    ((from === "CONFIRMED" || from === "PROCESSING") && to === "CANCELLED") ||
    (["CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "PARTIALLY_REFUNDED"].includes(from) && to === "REFUNDED");
}

export function reservationExpiry(now = new Date()): Date {
  return new Date(now.getTime() + ORDER_RESERVATION_DAYS * 24 * 60 * 60 * 1000);
}
