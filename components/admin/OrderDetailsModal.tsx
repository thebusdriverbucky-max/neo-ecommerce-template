// components/admin/OrderDetailsModal.tsx
"use client";

import { useEffect, useState } from "react";
import { Ban, Check, CreditCard, Mail, MapPin, Package, Phone, RotateCcw, Truck } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { OrderStatusBadge, type AdminOrder } from "@/components/admin/OrdersTable";
import { cn, formatPrice } from "@/lib/utils";
import {
  allowedStatusOptions,
  buildOrderPatch,
  isFreeOrder,
  orderPaymentActions,
  orderStatusHint,
  orderStatusLabel,
} from "@/lib/admin-orders";

const FULFILMENT_STEPS = [
  { status: "CONFIRMED", caption: "Paid", icon: CreditCard },
  { status: "PROCESSING", caption: "Packing", icon: Package },
  { status: "SHIPPED", caption: "With carrier", icon: Truck },
  { status: "DELIVERED", caption: "Received", icon: Check },
] as const;

// Statuses where the order is still being fulfilled and can be shipped.
const FULFILLABLE = ["CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "PARTIALLY_REFUNDED"];

type Busy = "save" | "cancel" | "refund" | null;

interface OrderDetailsModalProps {
  order: AdminOrder | null;
  onClose: () => void;
  /**
   * Called after a successful change with the order fields the API returned;
   * the page reloads the list and replaces `order` with its fresh copy.
   */
  onChanged: (orderId: string, updated: Partial<AdminOrder> | null) => Promise<void>;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{children}</h3>;
}

export default function OrderDetailsModal({ order, onClose, onChanged }: OrderDetailsModalProps) {
  const [nextStatus, setNextStatus] = useState("");
  const [tracking, setTracking] = useState("");
  const [restock, setRestock] = useState(true);
  const [confirming, setConfirming] = useState<"cancel" | "refund" | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const orderId = order?.id;
  useEffect(() => {
    setNotice("");
  }, [orderId]);

  // Reset the form whenever the order (or its fresh copy after a change) loads.
  useEffect(() => {
    if (!order) return;
    setNextStatus(order.status);
    setTracking(order.trackingNumber ?? "");
    setRestock(true);
    setConfirming(null);
    setError("");
  }, [order]);

  if (!order) return null;

  const label = order.orderNumber || order.id.slice(0, 8);
  const actions = orderPaymentActions(order);
  const targets = allowedStatusOptions(order.status).map((option) => option.value).slice(1);
  const fulfillable = FULFILLABLE.includes(order.status);
  const currentStep = order.status === "PARTIALLY_REFUNDED"
    ? 0
    : FULFILMENT_STEPS.findIndex((step) => step.status === order.status);
  const patch = buildOrderPatch(order, { status: nextStatus, trackingNumber: tracking });
  const hasChanges = patch.ok;
  const refunded = Number(order.refundedAmount ?? 0);
  const discount = Number(order.discountAmount ?? 0);
  const customerName = order.user?.name
    || (order.shippingAddress ? `${order.shippingAddress.firstName} ${order.shippingAddress.lastName}` : "Guest customer");
  const customerEmail = order.user?.email || order.guestEmail || order.shippingAddress?.email || "";

  const close = () => {
    if (!busy) onClose();
  };

  async function run(kind: Exclude<Busy, null>, request: () => Promise<Response>, success: (body: any) => string) {
    if (busy || !order) return;
    setBusy(kind);
    setError("");
    setNotice("");
    try {
      const response = await request();
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error || `Something went wrong (HTTP ${response.status}).`);
        return;
      }
      setNotice(success(body));
      setConfirming(null);
      // PATCH returns the order itself; the refund route wraps it in { order, refund }.
      const updated = kind === "refund" ? body?.order : body;
      await onChanged(order.id, updated && typeof updated === "object" ? updated : null);
    } catch {
      setError("Could not reach the server. Check your connection and retry.");
    } finally {
      setBusy(null);
    }
  }

  const save = () => {
    if (!patch.ok) {
      setError(patch.error);
      return;
    }
    void run(
      "save",
      () => fetch(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch.payload),
      }),
      () => "Changes saved.",
    );
  };

  const cancelOrder = () => run(
    "cancel",
    () => fetch(`/api/orders/${order.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "CANCELLED" }),
    }),
    () => "Order cancelled. The reserved stock is back in the catalog.",
  );

  const refundOrder = () => run(
    "refund",
    () => fetch(`/api/orders/${order.id}/refund`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restock: actions.canRestockOnRefund && restock }),
    }),
    (body) => body?.refund?.status === "pending"
      ? "Refund requested. Stripe is processing it; the status updates automatically."
      : `Refunded ${formatPrice(actions.refundableAmount ?? 0, order.currency)}.`,
  );

  return (
    <Modal open onOpenChange={(open) => !open && close()} title={`Order ${label}`} size="2xl">
      <div className="-mx-6 max-h-[calc(100vh-12rem)] space-y-5 overflow-y-auto px-6 pb-1">
        {/* Summary */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <OrderStatusBadge status={order.status} />
          <span className="text-sm text-gray-500">{formatDate(order.createdAt)}</span>
          <span className="ml-auto text-2xl font-bold">{formatPrice(order.total, order.currency)}</span>
        </div>

        {/* Customer and address */}
        <div className="grid gap-3 sm:grid-cols-2">
          <section className="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
            <SectionTitle>Customer</SectionTitle>
            <p className="font-medium">{customerName}</p>
            <p className="text-xs text-gray-500">{order.user ? "Customer account" : "Guest checkout"}</p>
            {customerEmail && (
              <a href={`mailto:${customerEmail}`} className="mt-2 flex items-center gap-2 text-sm text-blue-600 hover:underline dark:text-blue-400">
                <Mail className="h-4 w-4 shrink-0" />
                <span className="break-all">{customerEmail}</span>
              </a>
            )}
            {order.shippingAddress?.phone && (
              <p className="mt-1 flex items-center gap-2 text-sm">
                <Phone className="h-4 w-4 shrink-0 text-gray-400" />
                {order.shippingAddress.phone}
              </p>
            )}
          </section>
          <section className="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
            <SectionTitle>Ship to</SectionTitle>
            {order.shippingAddress ? (
              <div className="flex gap-2 text-sm">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                <div>
                  <p className="font-medium">{order.shippingAddress.firstName} {order.shippingAddress.lastName}</p>
                  <p>{order.shippingAddress.street}</p>
                  <p>{order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.postalCode}</p>
                  <p>{order.shippingAddress.country}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">No shipping address</p>
            )}
          </section>
        </div>

        {/* Items and totals */}
        <section className="rounded-lg border border-gray-200 dark:border-gray-800">
          <div className="divide-y divide-gray-200 dark:divide-gray-800">
            {order.items.map((item, index) => (
              <div key={index} className="flex items-baseline justify-between gap-4 px-4 py-2.5 text-sm">
                <span>
                  {item.product?.name ?? "Deleted product"}
                  <span className="text-gray-500"> × {item.quantity}</span>
                </span>
                <span className="whitespace-nowrap">{formatPrice(Number(item.price) * item.quantity, order.currency)}</span>
              </div>
            ))}
          </div>
          <div className="space-y-1 rounded-b-lg bg-gray-50 px-4 py-3 text-sm dark:bg-gray-900">
            {order.subtotal !== undefined && (
              <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>{formatPrice(order.subtotal, order.currency)}</span></div>
            )}
            {discount > 0 && (
              <div className="flex justify-between text-green-700 dark:text-green-400"><span>Discount</span><span>-{formatPrice(discount, order.currency)}</span></div>
            )}
            {order.shippingCost !== undefined && (
              <div className="flex justify-between"><span className="text-gray-500">Shipping</span><span>{formatPrice(order.shippingCost, order.currency)}</span></div>
            )}
            {order.tax !== undefined && Number(order.tax) > 0 && (
              <div className="flex justify-between"><span className="text-gray-500">Tax</span><span>{formatPrice(order.tax, order.currency)}</span></div>
            )}
            <div className="flex justify-between pt-1 font-semibold"><span>Total</span><span>{formatPrice(order.total, order.currency)}</span></div>
            {refunded > 0 && (
              <div className="flex justify-between text-red-600"><span>Refunded</span><span>-{formatPrice(refunded, order.currency)}</span></div>
            )}
          </div>
        </section>

        {/* Fulfilment */}
        {fulfillable ? (
          <section className="space-y-4 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
            <SectionTitle>Fulfilment</SectionTitle>
            <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {FULFILMENT_STEPS.map((step, index) => {
                const done = index <= currentStep;
                const selectable = targets.includes(step.status);
                const selected = nextStatus === step.status && step.status !== order.status;
                const Icon = step.icon;
                return (
                  <li key={step.status}>
                    <button
                      type="button"
                      disabled={!selectable || busy !== null}
                      aria-pressed={selected}
                      onClick={() => setNextStatus(selected ? order.status : step.status)}
                      className={cn(
                        "flex w-full flex-col items-center gap-1 rounded-lg border px-2 py-3 text-xs font-medium transition-colors",
                        done && "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300",
                        selected && "border-blue-600 bg-blue-600 text-white dark:border-blue-500 dark:bg-blue-600 dark:text-white",
                        selectable && !selected && "border-dashed border-gray-300 hover:border-blue-600 hover:text-blue-700 dark:border-gray-700 dark:hover:text-blue-300",
                        !done && !selectable && "border-gray-200 text-gray-400 dark:border-gray-800 dark:text-gray-600",
                      )}
                    >
                      <Icon className="h-5 w-5" />
                      <span>{orderStatusLabel(step.status)}</span>
                      <span className={cn("font-normal", selected ? "text-blue-100" : "text-gray-500")}>{step.caption}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {nextStatus !== order.status
                ? <>Will change to <strong>{orderStatusLabel(nextStatus)}</strong>: {orderStatusHint(nextStatus)}</>
                : targets.length > 0
                  ? <>{orderStatusHint(order.status)} Pick the next step above; steps you do not use can be skipped.</>
                  : orderStatusHint(order.status)}
            </p>
            <Input
              label="Tracking number"
              name="trackingNumber"
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
              placeholder="e.g. 1Z999AA10123456784"
              maxLength={100}
              disabled={busy !== null}
              helperText={order.status === "SHIPPED"
                ? "The customer is emailed when you change it."
                : "Saved on its own. The customer receives it with the Shipped email."}
            />
          </section>
        ) : (
          <section className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm dark:border-gray-800 dark:bg-gray-900">
            <p className="font-medium">{orderStatusLabel(order.status)}</p>
            <p className="mt-1 text-gray-600 dark:text-gray-400">{orderStatusHint(order.status)}</p>
            {order.trackingNumber && (
              <p className="mt-2">Tracking: <span className="font-mono">{order.trackingNumber}</span></p>
            )}
          </section>
        )}

        {/* Cancel or refund */}
        {(actions.canCancel || actions.refundableAmount !== null) && (
          <section className="space-y-3 rounded-lg border border-red-200 p-4 dark:border-red-900/60">
            <SectionTitle>{actions.canCancel ? "Cancel order" : "Refund"}</SectionTitle>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {actions.canCancel
                ? order.status === "PENDING"
                  ? "The customer has not paid. Cancelling closes the Stripe payment page and returns the reserved stock."
                  : "This order was free (100% discount), so there is no payment to refund. Cancelling returns the stock."
                : <>Returns {formatPrice(actions.refundableAmount ?? 0, order.currency)} to the customer through Stripe (usually 5-10 days to reach the card) and marks the order Refunded. For a partial refund use the Stripe Dashboard; the order updates automatically.</>}
            </p>
            {actions.canRestockOnRefund && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={restock}
                  onChange={(e) => setRestock(e.target.checked)}
                  disabled={busy !== null}
                  className="h-4 w-4 rounded border-gray-300"
                />
                Return the items to stock (they were not shipped)
              </label>
            )}
            {confirming ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md bg-red-50 p-3 text-sm dark:bg-red-950/40">
                <span className="mr-auto font-medium text-red-700 dark:text-red-300">
                  {confirming === "cancel"
                    ? "Cancel this order?"
                    : `Refund ${formatPrice(actions.refundableAmount ?? 0, order.currency)}? This cannot be undone.`}
                </span>
                <Button variant="outline" size="sm" onClick={() => setConfirming(null)} disabled={busy !== null}>
                  Keep order
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void (confirming === "cancel" ? cancelOrder() : refundOrder())}
                  disabled={busy !== null}
                >
                  {busy === "cancel" || busy === "refund" ? "Working..." : confirming === "cancel" ? "Yes, cancel" : "Yes, refund"}
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="gap-2 border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
                onClick={() => setConfirming(actions.canCancel ? "cancel" : "refund")}
                disabled={busy !== null}
              >
                {actions.canCancel ? <Ban className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
                {actions.canCancel ? "Cancel order" : `Refund ${formatPrice(actions.refundableAmount ?? 0, order.currency)}`}
              </Button>
            )}
          </section>
        )}

        {order.stripePaymentIntentId ? (
          <p className="text-xs text-gray-500">
            Stripe payment: <span className="font-mono">{order.stripePaymentIntentId}</span>
          </p>
        ) : fulfillable && !isFreeOrder(order) && (
          <p className="text-xs text-gray-500">
            No Stripe payment is linked to this order. Refund it from the Stripe Dashboard if needed.
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-800">
        <div className="mr-auto min-h-5 text-sm" aria-live="polite">
          {error && <p role="alert" className="text-red-600">{error}</p>}
          {!error && notice && <p className="text-green-700 dark:text-green-400">{notice}</p>}
        </div>
        <Button variant="outline" onClick={close} disabled={busy !== null}>
          Close
        </Button>
        {fulfillable && (
          <Button onClick={save} disabled={!hasChanges || busy !== null}>
            {busy === "save" ? "Saving..." : "Save changes"}
          </Button>
        )}
      </div>
    </Modal>
  );
}
