"use client";

import { useState } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/utils";
import { useCart } from "@/lib/cart-store";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { X } from "lucide-react";
import { useSettings } from "@/components/providers/settings-provider";
import { calculateStorefrontTotals } from "@/lib/discounts";

export function CartSummary() {
  const { items, discount, applyDiscount, removeDiscount } = useCart();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { settings } = useSettings();

  const { subtotal, discountAmount, discountError, tax, shipping, total: finalTotal } = calculateStorefrontTotals(items, discount, settings);
  const currency = settings?.currency || "USD";
  const taxRate = settings?.taxRate ?? 0;

  const handleApplyDiscount = async () => {
    if (!code.trim()) return;
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/discounts/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, orderAmount: subtotal }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to apply discount");
      } else {
        applyDiscount(data);
        setCode("");
      }
    } catch (err) {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gray-50 dark:bg-gray-800 p-6 rounded-lg sticky top-4">
      <h2 className="text-xl font-bold mb-4">Order Summary</h2>
      <div className="space-y-2 mb-4 pb-4 border-b">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{formatPrice(subtotal, currency)}</span>
        </div>

        {discount ? (
          <div className="flex justify-between text-green-600">
            <div className="flex items-center gap-2">
              <span>Discount ({discount.code})</span>
              <button onClick={removeDiscount} className="text-red-500 hover:text-red-700">
                <X className="w-4 h-4" />
              </button>
            </div>
            <span>-{formatPrice(discountAmount, currency)}</span>
          </div>
        ) : (
          <div className="flex gap-2 mt-4">
            <Input
              placeholder="Promo code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="bg-white"
            />
            <Button onClick={handleApplyDiscount} disabled={loading || !code.trim()}>
              Apply
            </Button>
          </div>
        )}
        {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
        {discountError && <p role="alert" className="text-red-500 text-sm mt-1">{discountError}. Remove or replace this code before checkout.</p>}

        <div className="flex justify-between mt-4">
          <span>Tax ({taxRate}%)</span>
          <span>{formatPrice(tax, currency)}</span>
        </div>
        <div className="flex justify-between">
          <span>Shipping</span>
          <span>{formatPrice(shipping, currency)}</span>
        </div>
      </div>
      <div className="flex justify-between text-xl font-bold mb-4">
        <span>Total</span>
        <span>{formatPrice(finalTotal, currency)}</span>
      </div>
      <Link
        href="/checkout"
        className="w-full block text-center bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700"
      >
        Proceed to Checkout
      </Link>
    </div>
  );
}
