// app/(dashboard)/admin/page.tsx
import { auth } from "@/lib/auth"; // Импортируем auth из вашей конфигурации
import { redirect } from "next/navigation";
import Link from "next/link";
import { Package, ShoppingCart, BarChart3, Ticket } from "lucide-react";

export const dynamic = 'force-dynamic';

export default async function AdminDashboard() {
  const session = await auth(); // Используем auth() вместо getServerSession

  if (session?.user?.role !== "ADMIN") {
    redirect("/");
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">Admin Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Products Card */}
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

        {/* Orders Card */}
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

        {/* Analytics Card */}
        <Link href="/admin/analytics">
          <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6 hover:shadow-lg transition-shadow cursor-pointer">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Analytics</h3>
              <BarChart3 className="w-8 h-8 text-purple-600" />
            </div>
            <p className="text-gray-600 dark:text-gray-400">
              Sales and performance metrics
            </p>
          </div>
        </Link>

        {/* Discounts Card */}
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
    </div>
  );
}
