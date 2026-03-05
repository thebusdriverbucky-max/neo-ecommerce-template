// components/admin/OrdersTable.tsx
"use client";

import { Button } from "@/components/ui/Button";
import { formatPrice } from "@/lib/utils";
import { Eye } from "lucide-react";

interface Order {
  id: string;
  orderNumber?: string | null;
  user?: { email: string; name: string } | null;
  guestEmail?: string | null;
  shippingAddress?: {
    firstName: string;
    lastName: string;
  } | null;
  status: string;
  total: string | number;
  currency: string;
  createdAt: string;
  items: Array<{
    product: { name: string };
    quantity: number;
    price: string | number;
  }>;
  trackingNumber?: string | null;
}

interface OrdersTableProps {
  orders: Order[];
  onViewDetails: (order: Order) => void;
}

export default function OrdersTable({ orders, onViewDetails }: OrdersTableProps) {
  const getCustomerName = (order: Order) => {
    if (order.user?.name) return order.user.name;
    if (order.shippingAddress) {
      return `${order.shippingAddress.firstName} ${order.shippingAddress.lastName}`;
    }
    return "Guest Customer";
  };

  const getCustomerEmail = (order: Order) => {
    return order.user?.email || order.guestEmail || "No email";
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
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
          {orders.map((order) => (
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
              <td className="px-6 py-4 font-semibold">
                {formatPrice(order.total, order.currency)}
              </td>
              <td className="px-6 py-4">
                <span
                  className={`text-xs px-2 py-1 rounded-full font-medium ${order.status === "PENDING"
                      ? "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300"
                      : order.status === "CONFIRMED"
                        ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                        : order.status === "PROCESSING"
                          ? "bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300"
                          : order.status === "SHIPPED"
                            ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300"
                            : order.status === "DELIVERED"
                              ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                              : order.status === "CANCELLED"
                                ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                                : order.status === "REFUNDED"
                                  ? "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                                  : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300"
                    }`}
                >
                  {order.status}
                </span>
              </td>
              <td className="px-6 py-4 text-sm">
                {formatDate(order.createdAt)}
              </td>
              <td className="px-6 py-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onViewDetails(order)}
                  className="gap-2"
                >
                  <Eye className="w-4 h-4" />
                  Details
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

