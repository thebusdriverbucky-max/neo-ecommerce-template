// app/(dashboard)/admin/orders/page.tsx

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import Pagination from "@/components/admin/Pagination";
import OrdersTable, { type AdminOrder } from "@/components/admin/OrdersTable";
import OrderDetailsModal from "@/components/admin/OrderDetailsModal";
import { ORDER_STATUSES, orderStatusLabel } from "@/lib/admin-orders";

const ORDERS_PER_PAGE = 25;

const statusFilterOptions = ORDER_STATUSES.map((value) => ({ value, label: orderStatusLabel(value) }));

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<AdminOrder | null>(null);
  const requestId = useRef(0);

  const totalPages = Math.max(1, Math.ceil(total / ORDERS_PER_PAGE));

  const fetchOrders = useCallback(async (): Promise<AdminOrder[]> => {
    const current = ++requestId.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(ORDERS_PER_PAGE) });
      if (statusFilter) params.set("status", statusFilter);
      if (searchQuery) params.set("q", searchQuery);
      const response = await fetch(`/api/orders?${params}`);
      const data = await response.json().catch(() => null);
      if (current !== requestId.current) return [];
      if (!response.ok || !data || !Array.isArray(data.orders)) {
        throw new Error(data?.error || `Could not load orders (HTTP ${response.status}).`);
      }
      const lastPage = Math.max(1, Math.ceil(data.total / ORDERS_PER_PAGE));
      if (data.orders.length === 0 && data.total > 0 && page > lastPage) {
        setPage(lastPage);
        return [];
      }
      setOrders(data.orders);
      setTotal(data.total);
      setListError("");
      return data.orders;
    } catch (error) {
      if (current === requestId.current) {
        setListError(error instanceof Error ? error.message : "Could not load orders. Check your connection and retry.");
      }
      return [];
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, [page, statusFilter, searchQuery]);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  // Keeps the open order in sync after a change. The list may no longer
  // contain it (e.g. a status filter), so the API response fills the gap.
  const handleOrderChanged = async (orderId: string, updated: Partial<AdminOrder> | null) => {
    if (updated) {
      setSelectedOrder((current) => (current?.id === orderId ? { ...current, ...updated } : current));
    }
    const refreshed = (await fetchOrders()).find((order) => order.id === orderId);
    if (refreshed) {
      setSelectedOrder((current) => (current?.id === orderId ? refreshed : current));
    }
  };

  const applyFilters = (event: React.FormEvent) => {
    event.preventDefault();
    setPage(1);
    setSearchQuery(searchInput.trim());
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">
        Order <span className="text-primary">Management</span>
      </h1>

      <form onSubmit={applyFilters} className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="sm:w-56">
          <label htmlFor="statusFilter" className="block text-sm font-medium mb-2">Status</label>
          <select
            id="statusFilter"
            name="statusFilter"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 dark:border-gray-700 dark:bg-gray-950 dark:text-white"
          >
            <option value="">All statuses</option>
            {statusFilterOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <Input
            label="Search"
            name="orderSearch"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Order number or customer email"
          />
        </div>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      <p className="text-xs text-gray-400 text-center mt-2 mb-3 md:hidden">
        ← Scroll left/right to see all actions →
      </p>

      {listError && (
        <div role="alert" className="mb-4 flex items-center gap-3 text-red-600">
          <span>{listError}</span>
          <Button variant="outline" size="sm" onClick={() => void fetchOrders()}>
            Retry
          </Button>
        </div>
      )}

      {loading && orders.length === 0 ? (
        <div className="text-center py-12">Loading...</div>
      ) : (
        <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
          <OrdersTable orders={orders} onViewDetails={setSelectedOrder} />
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} summary={`${total} orders`} />

      <OrderDetailsModal
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
        onChanged={handleOrderChanged}
      />
    </div>
  );
}
