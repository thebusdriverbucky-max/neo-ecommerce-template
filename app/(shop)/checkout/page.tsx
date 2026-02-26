// File: app/(shop)/checkout/page.tsx

"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCart } from "@/lib/cart-store";
import { CheckoutForm } from "@/components/shop/checkout-form";
import { OrderSummary } from "@/components/shop/order-summary";
import { redirect } from "next/navigation";

export default function CheckoutPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const { items, getTotalPrice, clearCart, discount } = useCart();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);


  if (items.length === 0) {
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

      const { url } = await response.json();

      // Redirect to Stripe checkout
      if (url) {
        clearCart();
        window.location.href = url;
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setLoading(false);
    }
  };

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
