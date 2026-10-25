// components/admin/OrdersTable.tsx
"use client";

import { Button } from "@/components/ui/Button";
import { formatPrice } from "@/lib/utils";
import { Eye } from "lucide-react";
import { orderPaymentActions, orderStatusLabel } from "@/lib/admin-orders";

export interface AdminOrder {
  id: string;
  orderNumber?: string | null;
  user?: { email: string; name: string | null } | null;
  guestEmail?: string | null;
  shippingAddress?: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  } | null;
  status: string;
  subtotal?: string | number;
  discountAmount?: string | number;
  discountCode?: string | null;
  tax?: string | number;
  shippingCost?: string | number;
  total: string | number;
  currency: string;
  createdAt: string;
  items: Array<{
    product: { name: string } | null;
    quantity: number;
    price: string | number;
  }>;
  trackingNumber?: string | null;
  // Bank-transfer snapshot shown to the customer when the order was placed.
  paymentIban?: string | null;
  paymentBankName?: string | null;
  paymentAccountName?: string | null;
  paymentDetails?: string | null;
  reservationExpiresAt?: string | null;
  reservationExpiredAt?: string | null;
  paymentConfirmedAt?: string | null;
}

export function OrderStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap ${STATUS_STYLES[status] ?? STATUS_STYLES.REFUNDED}`}
    >
      {orderStatusLabel(status)}
    </span>
  );
}

const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  CONFIRMED: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  PROCESSING: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300",
  SHIPPED: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300",
  DELIVERED: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  CANCELLED: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  PARTIALLY_REFUNDED: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  REFUNDED: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

export function formatOrderDate(value: string) {
  return new Date(value).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** One line under the status: when an unpaid order's reservation ends. */
function reservationNote(order: AdminOrder): { text: string; overdue: boolean } | null {
  if (order.status === "CANCELLED" && order.reservationExpiredAt) return { text: "Expired unpaid", overdue: false };
  if (order.status !== "PENDING" || !order.reservationExpiresAt) return null;
  if (orderPaymentActions(order).latePayment) return { text: "Reservation ended", overdue: true };
  return {
    text: `Reserved until ${new Date(order.reservationExpiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
    overdue: false,
  };
}

interface OrdersTableProps {
  orders: AdminOrder[];
  onViewDetails: (order: AdminOrder) => void;
}

export default function OrdersTable({ orders, onViewDetails }: OrdersTableProps) {
  const getCustomerName = (order: AdminOrder) => {
    if (order.user?.name) return order.user.name;
    if (order.shippingAddress) {
      return `${order.shippingAddress.firstName} ${order.shippingAddress.lastName}`;
    }
    return "Guest Customer";
  };

  const getCustomerEmail = (order: AdminOrder) => {
    return order.user?.email || order.guestEmail || "No email";
  };

  if (!orders || orders.length === 0) {
    return (
      <div className="text-center py-12 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
        <p className="text-gray-500">No orders found.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
      <table className="w-full">
        <thead className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800">
          <tr>
            <th className="text-left px-6 py-3 font-semibold">Order #</th>
            <th className="text-left px-6 py-3 font-semibold">Customer</th>
            <th className="text-left px-6 py-3 font-semibold">Tracking</th>
            <th className="text-left px-6 py-3 font-semibold">Total</th>
            <th className="text-left px-6 py-3 font-semibold">Status</th>
            <th className="text-left px-6 py-3 font-semibold">Date</th>
            <th className="text-left px-6 py-3 font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const note = reservationNote(order);
            return (
              <tr
                key={order.id}
                className="border-b border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <td className="px-6 py-4 font-mono text-sm">
                  {order.orderNumber || order.id.slice(0, 8)}
                </td>
                <td className="px-6 py-4">
                  <div className="text-sm">
                    <p className="font-medium">{getCustomerName(order)}</p>
                    <p className="text-gray-500 text-xs">
                      {getCustomerEmail(order)}
                    </p>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm font-mono">
                  {order.trackingNumber || "-"}
                </td>
                <td className="px-6 py-4 font-semibold whitespace-nowrap">
                  {formatPrice(order.total, order.currency)}
                </td>
                <td className="px-6 py-4">
                  <OrderStatusBadge status={order.status} />
                  {note && (
                    <p className={`mt-1 text-xs whitespace-nowrap ${note.overdue ? "text-amber-700 dark:text-amber-400" : "text-gray-500"}`}>
                      {note.text}
                    </p>
                  )}
                </td>
                <td className="px-6 py-4 text-sm">
                  {formatOrderDate(order.createdAt)}
                </td>
                <td className="px-6 py-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onViewDetails(order)}
                    className="gap-2"
                  >
                    <Eye className="w-4 h-4" />
                    Manage
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
