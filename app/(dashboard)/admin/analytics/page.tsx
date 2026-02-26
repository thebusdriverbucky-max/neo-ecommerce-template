// app/(dashboard)/admin/analytics/page.tsx

"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";

interface Analytics {
  totalOrders: number;
  totalRevenue: number;
  totalProducts: number;
  recentOrders: number;
  avgOrderValue: number;
  pendingOrders: number;
  confirmedOrders: number;
  revenueByDate: Record<string, number>;
}

export default function AdminAnalyticsPage() {
  const { data: session } = useSession();
  const [analytics, setAnalytics] = useState<Analytics>({
    totalOrders: 0,
    totalRevenue: 0,
    totalProducts: 0,
    recentOrders: 0,
    avgOrderValue: 0,
    pendingOrders: 0,
    confirmedOrders: 0,
    revenueByDate: {},
  });
  const [loading, setLoading] = useState(true);

  if (session?.user?.role !== "ADMIN") {
    redirect("/");
  }

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async () => {
    try {
      const response = await fetch("/api/admin/analytics");
      const data = await response.json();
      setAnalytics(data);
    } catch (error) {
      console.error("Failed to fetch analytics:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-center py-12">Loading...</div>;
  }

  const chartData = Object.entries(analytics.revenueByDate || {}).map(([date, revenue]) => ({
    name: date,
    sales: revenue,
  }));

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">
        Store <span className="text-primary">Analytics</span>
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Total Orders Card */}
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6">
          <p className="text-sm text-gray-500 dark:text-gray-400 uppercase mb-2">
            Total Orders
          </p>
          <p className="text-3xl font-bold">{analytics.totalOrders}</p>
          <p className="text-xs text-gray-400 mt-2">
            {analytics.recentOrders} in last 30 days
          </p>
        </div>

        {/* Total Revenue Card */}
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6">
          <p className="text-sm text-gray-500 dark:text-gray-400 uppercase mb-2">
            Total Revenue
          </p>
          <p className="text-3xl font-bold">${analytics.totalRevenue.toFixed(2)}</p>
          <p className="text-xs text-gray-400 mt-2">Lifetime revenue</p>
        </div>

        {/* Total Products Card */}
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6">
          <p className="text-sm text-gray-500 dark:text-gray-400 uppercase mb-2">
            Total Products
          </p>
          <p className="text-3xl font-bold">{analytics.totalProducts}</p>
          <p className="text-xs text-gray-400 mt-2">In catalog</p>
        </div>

        {/* Avg Order Value Card */}
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6">
          <p className="text-sm text-gray-500 dark:text-gray-400 uppercase mb-2">
            Avg Order Value
          </p>
          <p className="text-3xl font-bold">${analytics.avgOrderValue.toFixed(2)}</p>
          <p className="text-xs text-gray-400 mt-2">
            {analytics.pendingOrders} pending, {analytics.confirmedOrders} confirmed
          </p>
        </div>
      </div>

      {/* Charts */}
      <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6">
          <h2 className="text-lg font-semibold mb-4">Sales Trend</h2>
          <div className="h-64">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{
                    top: 5,
                    right: 30,
                    left: 20,
                    bottom: 5,
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="sales"
                    stroke="#8884d8"
                    activeDot={{ r: 8 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">
                No data available
              </div>
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6">
          <h2 className="text-lg font-semibold mb-4">Daily Revenue</h2>
          <div className="h-64">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{
                    top: 5,
                    right: 30,
                    left: 20,
                    bottom: 5,
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="sales" fill="#82ca9d" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">
                No data available
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
