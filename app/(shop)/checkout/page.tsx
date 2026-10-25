// File: app/(shop)/checkout/page.tsx

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { buildPreviousCheckouts, useCart } from "@/lib/cart-store";
import { calculateStorefrontTotals } from "@/lib/discounts";
import { belowMinimumNotice, describeCheckoutFailure, orderPagePath } from "@/lib/checkout-client";
import { CheckoutForm } from "@/components/shop/checkout-form";
import { OrderSummary } from "@/components/shop/order-summary";
import { useSettings } from "@/components/providers/settings-provider";
import { formatPrice } from "@/lib/utils";

type PaidOrder = { orderId: string; guestAccessToken?: string };

export default function CheckoutPage() {
  const router = useRouter();
  const { items, getTotalPrice, discount } = useCart();
  const { settings } = useSettings();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paidOrder, setPaidOrder] = useState<PaidOrder | null>(null);
  const checkoutRequestId = useRef(crypto.randomUUID());

  // The persisted cart is only available in the browser. Redirecting during
  // server rendering would bounce every direct visit to the cart page.
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (mounted && items.length === 0) router.replace("/cart");
  }, [mounted, items.length, router]);

  if (!mounted || items.length === 0) return null;

  const currency = settings?.currency || "USD";
  const totals = calculateStorefrontTotals(items, discount, settings);
  const minimum = belowMinimumNotice(totals.total, currency);
  const minimumMessage = minimum
    ? `Minimum order amount for card payments is ${formatPrice(minimum.minimumMajor, currency)}. Add more items to continue.`
    : null;

  const handleCheckout = async (formData: any) => {
    if (minimum) return;
    setLoading(true);
    setError(null);
    setPaidOrder(null);

    try {
      // Earlier attempts that went to Stripe and came back still hold stock
      // and count as pending orders; the server releases them first.
      const previousCheckouts = buildPreviousCheckouts(useCart.getState().pendingCheckouts);
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items,
          shippingAddress: formData.shippingAddress,
          billingAddressId: undefined,
          total: getTotalPrice(),
          discountCode: discount?.code,
          guestEmail: formData.shippingAddress.email,
          checkoutRequestId: checkoutRequestId.current,
          ...(previousCheckouts.length > 0 ? { previousCheckouts } : {}),
        }),
      });

      if (!response.ok) {
        // A definitive answer: retrying with the same request id would just
        // replay it, so the next attempt gets a fresh one.
        checkoutRequestId.current = crypto.randomUUID();
        const failure = describeCheckoutFailure(await response.json().catch(() => null));
        setError(failure.message);
        if (failure.paidOrder) setPaidOrder(failure.paidOrder);
        return;
      }

      const { url, orderId, guestAccessToken } = await response.json();

      // Redirect to Stripe checkout
      if (url && typeof orderId === "string") {
        const cart = useCart.getState();
        cart.forgetCheckouts(previousCheckouts.map((checkout) => checkout.orderId));
        cart.rememberCheckout(orderId, items, typeof guestAccessToken === "string" ? guestAccessToken : undefined);
        window.location.href = url;
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (err) {
      // Network failure: keep the request id so a retry stays idempotent.
      setError(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">Checkout</h1>
      {error && (
        <div role="alert" className="mb-4 p-4 bg-red-50 text-red-700 rounded-lg">
          <p>{error}</p>
          {paidOrder && (
            <Link
              href={orderPagePath(paidOrder.orderId, paidOrder.guestAccessToken)}
              className="mt-2 inline-block font-medium underline"
            >
              View your order
            </Link>
          )}
        </div>
      )}
      <div className="flex flex-col lg:flex-row gap-8">
        <div className="lg:w-2/3 order-last lg:order-first">
          <CheckoutForm onSubmit={handleCheckout} loading={loading} blockedReason={minimumMessage} />
        </div>
        <div className="lg:w-1/3">
          <OrderSummary items={items} />
        </div>
      </div>
    </div>
  );
}
