// File: app/(shop)/checkout/page.tsx

"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCart } from "@/lib/cart-store";
import { CheckoutForm } from "@/components/shop/checkout-form";
import { OrderSummary } from "@/components/shop/order-summary";
import { redirect } from "next/navigation";
import { getSettings } from "@/app/actions/settings";

export default function CheckoutPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const { items, getTotalPrice, clearCart, discount } = useCart();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<any>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [finalTotal, setFinalTotal] = useState<number>(0);

  useEffect(() => {
    const fetchSettings = async () => {
      const result = await getSettings();
      if (result.success) {
        setSettings(result.data);
      }
    };
    fetchSettings();
  }, []);

  if (items.length === 0 && !orderId) {
    redirect("/cart");
  }

  const handleCheckout = async (formData: any) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items,
          shippingAddress: formData.shippingAddress,
          billingAddressId: formData.billingAddressId,
          total: getTotalPrice(),
          discountCode: discount?.code,
          guestEmail: !session ? formData.shippingAddress.email : undefined,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to create order");
      }

      const { orderId, orderNumber } = await response.json();

      if (orderId) {
        // Calculate final total including tax and shipping for display
        const subtotal = getTotalPrice();
        const discountAmount = discount ? (discount.type === "PERCENT" ? (subtotal * discount.value) / 100 : discount.value) : 0;
        const taxableAmount = Math.max(0, subtotal - discountAmount);

        const taxRate = settings?.taxRate ?? 0;
        const freeShippingThreshold = settings?.freeShippingThreshold ?? Infinity;
        const shippingCost = taxableAmount >= freeShippingThreshold ? 0 : settings?.shippingCost ?? 0;

        const tax = taxableAmount * (taxRate / 100);
        const total = taxableAmount + tax + shippingCost;

        setFinalTotal(total);
        setOrderId(orderId);
        setOrderNumber(orderNumber);
        clearCart();
      } else {
        throw new Error("No order ID returned");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setLoading(false);
    }
  };

  if (orderId && settings) {
    const total = finalTotal;
    const currency = settings.currency || "USD";

    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          <div className="bg-green-50 border border-green-200 rounded-lg p-6 mb-8">
            <h2 className="text-2xl font-bold text-green-800 mb-2">Order Placed!</h2>
            <p className="text-green-700">
              Your order {orderNumber || `#${orderId.slice(-8).toUpperCase()}`} has been created. Please complete the payment to confirm it.
            </p>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <h3 className="font-semibold text-lg mb-4">Payment Instructions</h3>
            <p className="text-gray-600 mb-4">
              Please transfer the exact order amount to the following bank account.
              Your order will be confirmed once payment is received.
            </p>

            <div className="space-y-3 bg-white rounded-lg p-4 border">
              <div className="flex justify-between">
                <span className="text-gray-500">IBAN:</span>
                <span className="font-mono font-medium">{settings.paymentIban}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Bank:</span>
                <span className="font-medium">{settings.paymentBankName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Account Name:</span>
                <span className="font-medium">{settings.paymentAccountName}</span>
              </div>
              <div className="flex justify-between border-t pt-3">
                <span className="text-gray-500">Amount to pay:</span>
                <span className="font-bold text-lg">{total.toFixed(2)} {currency}</span>
              </div>
            </div>

            {settings.paymentDetails && (
              <p className="mt-3 text-sm text-gray-600">{settings.paymentDetails}</p>
            )}
          </div>

          <div className="mt-8 text-center">
            <button
              onClick={() => router.push(`/orders/${orderId}`)}
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
