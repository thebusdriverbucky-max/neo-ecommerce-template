// app/(dashboard)/admin/orders/page.tsx

"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import OrdersTable from "@/components/admin/OrdersTable";
import { formatPrice } from "@/lib/utils";

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

const orderStatuses = [
  { value: "PENDING", label: "Pending" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "PROCESSING", label: "Processing" },
  { value: "SHIPPED", label: "Shipped" },
  { value: "DELIVERED", label: "Delivered" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "REFUNDED", label: "Refunded" },
];

export default function AdminOrdersPage() {
  const { data: session } = useSession();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [newStatus, setNewStatus] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");

  const [currentPage, setCurrentPage] = useState(1);
  const ORDERS_PER_PAGE = 50;
  const totalPages = Math.ceil(orders.length / ORDERS_PER_PAGE);
  const paginatedOrders = orders.slice(
    (currentPage - 1) * ORDERS_PER_PAGE,
    currentPage * ORDERS_PER_PAGE
  );

  // УБРАНА ПРОВЕРКА - middleware проверяет!

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    try {
      const response = await fetch("/api/orders");
      const data = await response.json();
      setOrders(data);
      setCurrentPage(1);
    } catch (error) {
      console.error("Failed to fetch orders:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusUpdate = async () => {
    if (!selectedOrder || !newStatus) return;

    try {
      const response = await fetch(`/api/orders/${selectedOrder.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: newStatus,
          trackingNumber: trackingNumber || undefined
        }),
      });

      if (response.ok) {
        await fetchOrders();
        setStatusDialogOpen(false);
        setNewStatus("");
        setTrackingNumber("");
      }
    } catch (error) {
      console.error("Failed to update order status:", error);
    }
  };

  const handleViewDetails = (order: Order) => {
    setSelectedOrder(order);
    setDetailsOpen(true);
  };

  const openStatusDialog = () => {
    if (selectedOrder) {
      setNewStatus(selectedOrder.status);
      setTrackingNumber(selectedOrder.trackingNumber || "");
      setStatusDialogOpen(true);
    }
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

  const getPageNumbers = () => {
    if (totalPages <= 5) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    if (currentPage <= 3) {
      return [1, 2, 3, 4, "...", totalPages];
    }

    if (currentPage >= totalPages - 2) {
      return [1, "...", totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    }

    return [1, "...", currentPage - 1, currentPage, currentPage + 1, "...", totalPages];
  };

  if (loading) {
    return <div className="text-center py-12">Loading...</div>;
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">
        Order <span className="text-primary">Management</span>
      </h1>

      <p className="text-xs text-gray-400 text-center mt-2 mb-3 md:hidden">
        ← Scroll left/right to see all actions →
      </p>

      <OrdersTable orders={paginatedOrders} onViewDetails={handleViewDetails} />

      {totalPages > 1 && (
        <div className="mt-6 flex flex-col items-center gap-4">
          <div className="flex justify-center gap-1 items-center">
            <Button
              variant="outline"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              &larr; Prev
            </Button>

            {getPageNumbers().map((page, index) => {
              if (page === "...") {
                return (
                  <span key={`ellipsis-${index}`} className="px-2 text-gray-500">
                    ...
                  </span>
                );
              }

              return (
                <Button
                  key={page}
                  variant={currentPage === page ? "default" : "outline"}
                  onClick={() => setCurrentPage(page as number)}
                  className={currentPage === page ? "font-bold" : ""}
                >
                  {page}
                </Button>
              );
            })}

            <Button
              variant="outline"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              Next &rarr;
            </Button>
          </div>
          <div className="text-sm text-gray-500">
            Page {currentPage} of {totalPages}
          </div>
        </div>
      )}

      {/* Order Details Modal */}
      <Dialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        title="Order Details"
        onConfirm={openStatusDialog}
        confirmText="Update Status"
        cancelText="Close"
        size="xl"
      >
        {selectedOrder && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500 uppercase">Order Number</p>
                <p className="font-mono">{selectedOrder.orderNumber || selectedOrder.id.slice(0, 8)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase">Date</p>
                <p>{formatDate(selectedOrder.createdAt)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase">Customer</p>
                <p>{getCustomerName(selectedOrder)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase">Email</p>
                <p className="text-sm">{getCustomerEmail(selectedOrder)}</p>
              </div>
              {selectedOrder.trackingNumber && (
                <div className="col-span-2">
                  <p className="text-xs text-gray-500 uppercase">Tracking Number</p>
                  <p className="font-mono">{selectedOrder.trackingNumber}</p>
                </div>
              )}
            </div>

            <div>
              <p className="text-xs text-gray-500 uppercase mb-2">Items</p>
              <div className="space-y-2">
                {selectedOrder.items.map((item, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span>{item.product.name} x{item.quantity}</span>
                    <span>{formatPrice(Number(item.price) * item.quantity, selectedOrder.currency)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t pt-4">
              <p className="text-xs text-gray-500 uppercase mb-2">Total</p>
              <p className="text-2xl font-bold">{formatPrice(selectedOrder.total, selectedOrder.currency)}</p>
            </div>
          </div>
        )}
      </Dialog>

      {/* Status Update Dialog */}
      <Dialog
        open={statusDialogOpen}
        onOpenChange={setStatusDialogOpen}
        title="Update Order Status"
        onConfirm={handleStatusUpdate}
        confirmText="Update"
      >
        <div className="space-y-4">
          <Select
            label="New Status"
            options={orderStatuses}
            value={newStatus}
            onChange={(e) => setNewStatus(e.target.value)}
            required
          />

          <Input
            label="Tracking Number"
            value={trackingNumber}
            onChange={(e) => setTrackingNumber(e.target.value)}
            placeholder="Enter tracking number (optional)"
          />
        </div>
      </Dialog>
    </div>
  );
}
