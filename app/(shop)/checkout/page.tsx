// File: app/(shop)/checkout/page.tsx

"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCart } from "@/lib/cart-store";
import { CheckoutForm } from "@/components/shop/checkout-form";
import { OrderSummary } from "@/components/shop/order-summary";
import { redirect } from "next/navigation";

const COMPLETION_STORAGE_KEY = "manual-checkout-completion";
const REQUEST_STORAGE_KEY = "manual-checkout-request";

function readStorage(key: string) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function writeStorage(key: string, value?: string) {
  try { if (value === undefined) sessionStorage.removeItem(key); else sessionStorage.setItem(key, value); } catch { /* Storage can be disabled; checkout must still finish. */ }
}

export default function CheckoutPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const { items, reconcilePurchase, discount } = useCart();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [finalTotal, setFinalTotal] = useState<number>(0);
  const [paymentSnapshot, setPaymentSnapshot] = useState<any>(null);
  const [orderUrl, setOrderUrl] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const initialCartEmpty = useRef(items.length === 0);
  const inFlight = useRef(false);
  const requestRef = useRef<{ key: string; fingerprint: string } | null>(null);

  useEffect(() => {
    if (initialCartEmpty.current) {
      try {
        const stored = readStorage(COMPLETION_STORAGE_KEY);
        if (stored) {
          const result = JSON.parse(stored);
          if (result?.orderId && result?.orderUrl && Number.isFinite(result?.total)) {
            setOrderId(result.orderId);
            setOrderNumber(result.orderNumber);
            setFinalTotal(result.total);
            setPaymentSnapshot(result);
            setOrderUrl(result.orderUrl);
          }
        }
      } catch {
        writeStorage(COMPLETION_STORAGE_KEY);
      }
    } else {
      writeStorage(COMPLETION_STORAGE_KEY);
    }
    setHydrated(true);
  }, []); // Deliberately restore only the cart snapshot present when this page mounts.

  if (!hydrated) return <div className="container mx-auto px-4 py-8">Loading checkout...</div>;

  if (items.length === 0 && !orderId) {
    redirect("/cart");
  }

  const handleCheckout = async (formData: any) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);

    try {
      const checkoutItems = items.map(({ productId, quantity }) => ({ productId, quantity }));
      const requestPayload = {
        items: checkoutItems,
        shippingAddress: formData.shippingAddress,
        billingAddressId: formData.billingAddressId,
        discountCode: discount?.code,
        guestEmail: !session ? formData.shippingAddress.email : undefined,
      };
      const fingerprint = JSON.stringify(requestPayload);
      let storedRequest: { key: string; fingerprint: string } | null = null;
      try {
        storedRequest = requestRef.current || JSON.parse(readStorage(REQUEST_STORAGE_KEY) || "null");
      } catch {
        writeStorage(REQUEST_STORAGE_KEY);
      }
      const requestId = storedRequest?.fingerprint === fingerprint ? storedRequest.key : crypto.randomUUID();
      if (storedRequest?.fingerprint !== fingerprint) {
        requestRef.current = { key: requestId, fingerprint };
        writeStorage(REQUEST_STORAGE_KEY, JSON.stringify(requestRef.current));
      }
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": requestId },
        body: JSON.stringify(requestPayload),
      });

      if (!response.ok) {
        const failure = await response.json().catch(() => null);
        throw new Error(failure?.error || "Failed to create order");
      }

      const result = await response.json();
      const { orderId, orderNumber } = result;

      if (orderId) {
        setFinalTotal(result.total);
        setOrderId(orderId);
        setOrderNumber(orderNumber);
        setPaymentSnapshot(result);
        setOrderUrl(result.orderUrl);
        writeStorage(COMPLETION_STORAGE_KEY, JSON.stringify(result));
        reconcilePurchase(result.purchasedItems || checkoutItems);
        writeStorage(REQUEST_STORAGE_KEY);
        requestRef.current = null;
      } else {
        throw new Error("No order ID returned");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  if (orderId && paymentSnapshot) {
    const total = finalTotal;
    const currency = paymentSnapshot.currency || "USD";
    const hasBankDetails = Boolean(paymentSnapshot.paymentIban);

    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          <div className="bg-green-50 border border-green-200 rounded-lg p-6 mb-8">
            <h2 className="text-2xl font-bold text-green-800 mb-2">Order Placed!</h2>
            <p className="text-green-700">
              Your order {orderNumber || `#${orderId.slice(-8).toUpperCase()}`} has been created. Please complete the payment to confirm it.
            </p>
          </div>

          {hasBankDetails ? (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
              <h3 className="font-semibold text-lg mb-4">Payment Instructions</h3>
              <p className="text-gray-600 mb-4">
                Please transfer the exact order amount to the following bank account.
                Your order will be confirmed once payment is received.
              </p>

              <div className="space-y-3 bg-white rounded-lg p-4 border">
                <div className="flex justify-between gap-4">
                  <span className="text-gray-500">IBAN:</span>
                  <span className="font-mono font-medium">{paymentSnapshot.paymentIban}</span>
                </div>
                {paymentSnapshot.paymentBankName && <div className="flex justify-between gap-4">
                  <span className="text-gray-500">Bank:</span>
                  <span className="font-medium">{paymentSnapshot.paymentBankName}</span>
                </div>}
                {paymentSnapshot.paymentAccountName && <div className="flex justify-between gap-4">
                  <span className="text-gray-500">Account Name:</span>
                  <span className="font-medium">{paymentSnapshot.paymentAccountName}</span>
                </div>}
                <div className="flex justify-between gap-4 border-t pt-3">
                  <span className="text-gray-500">Amount to pay:</span>
                  <span className="font-bold text-lg">{total.toFixed(2)} {currency}</span>
                </div>
              </div>

              {paymentSnapshot.paymentDetails && (
                <p className="mt-3 whitespace-pre-line text-sm text-gray-600">{paymentSnapshot.paymentDetails}</p>
              )}
              <p className="mt-3 text-sm text-gray-600">Stock is reserved for 7 days. A transfer arriving later requires manual support review and cannot be confirmed automatically.</p>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-950">
              <h3 className="mb-2 text-lg font-semibold">Payment Instructions</h3>
              <p className="whitespace-pre-line text-sm">{paymentSnapshot.paymentFallbackMessage}</p>
            </div>
          )}

          <div className="mt-8 text-center">
            <button
              onClick={() => router.push(orderUrl || `/orders/${orderId}`)}
              className="text-blue-600 hover:underline"
            >
              View Order Details
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">Checkout</h1>
      {error && (
        <div className="mb-4 p-4 bg-red-50 text-red-700 rounded-lg">
          {error}
        </div>
      )}
      <div className="flex flex-col lg:flex-row gap-8">
        <div className="lg:w-2/3 order-last lg:order-first">
          <CheckoutForm onSubmit={handleCheckout} loading={loading} />
        </div>
        <div className="lg:w-1/3">
          <OrderSummary items={items} />
        </div>
      </div>
    </div>
  );
}
