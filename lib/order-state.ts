import { OrderStatus } from "@prisma/client";

// Fulfilment only moves forward, and optional steps can be skipped (a store
// may go straight from Confirmed to Shipped, or to Delivered for pickup).
// CANCELLED is for orders without a payment; paid orders end as REFUNDED
// through a Stripe refund instead (see app/api/orders/[id]/route.ts).
const transitions: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ["CANCELLED"],
  CONFIRMED: ["PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"],
  PROCESSING: ["SHIPPED", "DELIVERED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
  // The items left after a partial refund can still be shipped.
  PARTIALLY_REFUNDED: ["PROCESSING", "SHIPPED", "DELIVERED"],
  REFUNDED: [],
};

export function canTransitionOrder(
  current: OrderStatus,
  next: OrderStatus,
  isAdmin: boolean
): boolean {
  if (!isAdmin && next !== "CANCELLED") return false;
  return transitions[current].includes(next);
}

export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return transitions[status].length === 0;
}
