// app/(dashboard)/admin/analytics/page.tsx

"use client";

import { useState, useEffect, useCallback } from "react";
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
import { formatPrice } from "@/lib/utils";
import { ORDER_STATUSES, orderStatusLabel } from "@/lib/admin-orders";

interface Analytics {
  currency: string;
  grossSales: number;
  refunds: number;
  netRevenue: number;
  paidOrders: number;
  avgOrderValue: number;
  otherCurrencyPaidOrders: number;
  ordersByStatus: Record<string, number>;
  dailyRevenue: Array<{ date: string; revenue: number }>;
  totalOrders: number;
  recentOrders: number;
  totalProducts: number;
}

const EMPTY_ANALYTICS: Analytics = {
  currency: "USD",
  grossSales: 0,
  refunds: 0,
  netRevenue: 0,
  paidOrders: 0,
  avgOrderValue: 0,
  otherCurrencyPaidOrders: 0,
  ordersByStatus: {},
  dailyRevenue: [],
  totalOrders: 0,
  recentOrders: 0,
  totalProducts: 0,
};

export default function AdminAnalyticsPage() {
  const { data: session, status: sessionStatus } = useSession();
  const [analytics, setAnalytics] = useState<Analytics>(EMPTY_ANALYTICS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  if (sessionStatus !== "loading" && session?.user?.role !== "ADMIN") {
    redirect("/");
  }

  const fetchAnalytics = useCallback(async () => {
    setError(null);

    try {
      const response = await fetch("/api/admin/analytics");
      const data: Analytics | { error?: string } = await response.json();

      if (!response.ok) {
        throw new Error("error" in data && data.error
          ? data.error
          : "Failed to fetch analytics");
      }

      setAnalytics({ ...EMPTY_ANALYTICS, ...(data as Partial<Analytics>) });
    } catch (error) {
      console.error("Failed to fetch analytics:", error);
      setError(error instanceof Error ? error.message : "Failed to fetch analytics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  if (loading || sessionStatus === "loading") {
    return <div className="text-center py-12">Loading...</div>;
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-8">
          Store <span className="text-primary">Analytics</span>
        </h1>
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-800">
          <p className="font-semibold">Analytics is temporarily unavailable</p>
          <p className="mt-2 text-sm">{error}</p>
          <button
            type="button"
            className="mt-4 rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800"
            onClick={() => {
              setLoading(true);
              void fetchAnalytics();
            }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const currency = analytics.currency;
  const money = (value: number) => formatPrice(value, currency);
  const chartData = (analytics.dailyRevenue || []).map(({ date, revenue }) => ({
    name: date.slice(5),
    date,
    sales: revenue,
  }));
  const hasSales = chartData.some((entry) => entry.sales !== 0);
  const statusEntries = ORDER_STATUSES.map((status) => ({
    status,
    count: analytics.ordersByStatus?.[status] ?? 0,
  })).filter((entry) => entry.count > 0);

  const card = "bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6";
  const cardLabel = "text-sm text-gray-500 dark:text-gray-400 uppercase mb-2";

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">
        Store <span className="text-primary">Analytics</span>
      </h1>

      {analytics.otherCurrencyPaidOrders > 0 && (
        <p role="status" className="mb-6 rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
          {analytics.otherCurrencyPaidOrders} paid order(s) were placed in a currency other than {currency} and are
          not included in the amounts below.
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className={card}>
          <p className={cardLabel}>Net Revenue</p>
          <p className="text-3xl font-bold">{money(analytics.netRevenue)}</p>
          <p className="text-xs text-gray-400 mt-2">Paid sales minus refunds</p>
        </div>

        <div className={card}>
          <p className={cardLabel}>Gross Sales</p>
          <p className="text-3xl font-bold">{money(analytics.grossSales)}</p>
          <p className="text-xs text-gray-400 mt-2">{analytics.paidOrders} paid orders</p>
        </div>

        <div className={card}>
          <p className={cardLabel}>Refunds</p>
          <p className="text-3xl font-bold">{money(analytics.refunds)}</p>
          <p className="text-xs text-gray-400 mt-2">
            {(analytics.ordersByStatus?.PARTIALLY_REFUNDED ?? 0) + (analytics.ordersByStatus?.REFUNDED ?? 0)} refunded
            orders
          </p>
        </div>

        <div className={card}>
          <p className={cardLabel}>Avg Order Value</p>
          <p className="text-3xl font-bold">{money(analytics.avgOrderValue)}</p>
          <p className="text-xs text-gray-400 mt-2">Gross sales per paid order</p>
        </div>

        <div className={card}>
          <p className={cardLabel}>Total Orders</p>
          <p className="text-3xl font-bold">{analytics.totalOrders}</p>
          <p className="text-xs text-gray-400 mt-2">{analytics.recentOrders} in last 30 days</p>
        </div>

        <div className={card}>
          <p className={cardLabel}>Total Products</p>
          <p className="text-3xl font-bold">{analytics.totalProducts}</p>
          <p className="text-xs text-gray-400 mt-2">Active in catalog</p>
        </div>

        <div className={`${card} md:col-span-2`}>
          <p className={cardLabel}>Orders by Status</p>
          {statusEntries.length > 0 ? (
            <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              {statusEntries.map(({ status, count }) => (
                <li key={status} className="flex justify-between">
                  <span>{orderStatusLabel(status)}</span>
                  <span className="font-semibold">{count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500">No orders yet</p>
          )}
        </div>
      </div>

      {/* Charts */}
      <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className={card}>
          <h2 className="text-lg font-semibold mb-1">Sales Trend</h2>
          <p className="text-xs text-gray-400 mb-4">Net revenue per day, last 30 days (UTC)</p>
          <div className="h-64">
            {hasSales ? (
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
                  <Tooltip
                    labelFormatter={(_label, payload) => payload?.[0]?.payload?.date ?? _label}
                    formatter={(value) => [money(Number(value)), "Net revenue"]}
                  />
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
                No sales in the last 30 days
              </div>
            )}
          </div>
        </div>

        <div className={card}>
          <h2 className="text-lg font-semibold mb-1">Daily Revenue</h2>
          <p className="text-xs text-gray-400 mb-4">Net revenue per day, last 30 days (UTC)</p>
          <div className="h-64">
            {hasSales ? (
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
                  <Tooltip
                    labelFormatter={(_label, payload) => payload?.[0]?.payload?.date ?? _label}
                    formatter={(value) => [money(Number(value)), "Net revenue"]}
                  />
                  <Bar dataKey="sales" fill="#82ca9d" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">
                No sales in the last 30 days
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
