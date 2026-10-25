// app/(dashboard)/admin/page.tsx
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Package, ShoppingCart, Ticket, AlertTriangle, Eye, Clock } from "lucide-react";
import { db } from "@/lib/db";
import { formatPrice } from "@/lib/utils";
import { getStoreSettings } from "@/lib/store-settings";

// Lite orders always carry a reservation; this matches the admin order list.
const LITE_ORDERS = { reservationExpiresAt: { not: null } };

const STATUS_BADGES: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  DELIVERED: "bg-green-100 text-green-700",
  CANCELLED: "bg-red-100 text-red-700",
  REFUNDED: "bg-gray-100 text-gray-700",
  PARTIALLY_REFUNDED: "bg-gray-100 text-gray-700",
};
const ACTIVE_STATUS_BADGE = "bg-blue-100 text-blue-700";

function customerName(order: {
  user?: { name: string | null; email: string | null } | null;
  guestEmail?: string | null;
  shippingAddress?: { firstName: string; lastName: string } | null;
}) {
  const addressName = `${order.shippingAddress?.firstName ?? ""} ${order.shippingAddress?.lastName ?? ""}`.trim();
  return order.user?.name?.trim() || addressName || order.user?.email || order.guestEmail || "Guest";
}

export default async function AdminDashboard() {
  const session = await auth();

  if (session?.user?.role !== "ADMIN") {
    redirect("/");
  }

  const settings = await getStoreSettings(db);
  const storeCurrency = settings?.currency || "USD";

  // Unpaid bank-transfer orders waiting for the admin to confirm payment
  const awaitingPayment = await db.order.count({
    where: { ...LITE_ORDERS, status: "PENDING" },
  });

  // Fetch recent orders
  const recentOrders = await db.order.findMany({
    where: LITE_ORDERS,
    take: 5,
    orderBy: {
      createdAt: "desc",
    },
    include: {
      user: {
        select: {
          name: true,
          email: true,
        },
      },
      shippingAddress: true,
    },
  });

  // Fetch low stock products
  const lowStockProducts = await db.product.findMany({
    where: {
      stock: {
        lt: 10,
      },
      isArchived: false,
    },
    orderBy: {
      stock: "asc",
    },
    take: 5,
  });

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">Admin Dashboard</h1>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
        <Link href="/admin/products">
          <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6 hover:shadow-lg transition-shadow cursor-pointer">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Products</h3>
              <Package className="w-8 h-8 text-blue-600" />
            </div>
            <p className="text-gray-600 dark:text-gray-400">
              Manage your product catalog
            </p>
          </div>
        </Link>

        <Link href="/admin/orders">
          <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6 hover:shadow-lg transition-shadow cursor-pointer">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Orders</h3>
              <ShoppingCart className="w-8 h-8 text-green-600" />
            </div>
            <p className="text-gray-600 dark:text-gray-400">
              View and manage orders
            </p>
          </div>
        </Link>

        <Link href="/admin/orders">
          <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6 hover:shadow-lg transition-shadow cursor-pointer">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Awaiting payment</h3>
              <Clock className="w-8 h-8 text-amber-600" />
            </div>
            <p className="text-3xl font-bold" data-testid="awaiting-payment-count">{awaitingPayment}</p>
            <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">
              Orders waiting for a bank transfer
            </p>
          </div>
        </Link>

        <Link href="/admin/discounts">
          <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6 hover:shadow-lg transition-shadow cursor-pointer">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Discounts</h3>
              <Ticket className="w-8 h-8 text-orange-600" />
            </div>
            <p className="text-gray-600 dark:text-gray-400">
              Manage discounts and promotions
            </p>
          </div>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Orders Table */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold">Recent Orders</h2>
            <Link href="/admin/orders" className="text-blue-600 hover:underline text-sm">
              View all orders
            </Link>
          </div>
          <div className="overflow-x-auto bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
            <table className="w-full text-left">
              <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-800">
                <tr>
                  <th className="px-6 py-3 font-semibold text-sm">Order</th>
                  <th className="px-6 py-3 font-semibold text-sm">Customer</th>
                  <th className="px-6 py-3 font-semibold text-sm">Total</th>
                  <th className="px-6 py-3 font-semibold text-sm">Status</th>
                  <th className="px-6 py-3 font-semibold text-sm">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {recentOrders.length > 0 ? (
                  recentOrders.map((order) => (
                    <tr key={order.id} className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                      <td className="px-6 py-4 text-sm font-mono">
                        {order.orderNumber || order.id.slice(0, 8)}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        {customerName(order)}
                      </td>
                      <td className="px-6 py-4 text-sm font-semibold">
                        {formatPrice(Number(order.total), order.currency || storeCurrency)}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_BADGES[order.status] ?? ACTIVE_STATUS_BADGE}`}>
                          {order.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <Link href={`/admin/orders`}>
                          <Eye className="w-4 h-4 text-gray-500 hover:text-blue-600 cursor-pointer" />
                        </Link>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                      No recent orders found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Low Stock Alerts */}
        <div>
          <h2 className="text-2xl font-bold mb-4">Low Stock Alerts</h2>
          <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
            {lowStockProducts.length > 0 ? (
              <div className="divide-y divide-gray-200 dark:divide-gray-800">
                {lowStockProducts.map((product) => (
                  <div key={product.id} className="p-4 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{product.name}</p>
                      <p className="text-xs text-gray-500">Stock: {product.stock} units left</p>
                    </div>
                    <AlertTriangle className="w-5 h-5 text-amber-500" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center text-gray-500 text-sm">
                All products are well stocked.
              </div>
            )}
            <div className="p-4 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-800">
              <Link href="/admin/products" className="text-blue-600 hover:underline text-sm block text-center font-medium">
                Manage Inventory
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
