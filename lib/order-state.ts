import { OrderStatus } from "@prisma/client";

const transitions: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ["CANCELLED"],
  CONFIRMED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
  PARTIALLY_REFUNDED: [],
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
