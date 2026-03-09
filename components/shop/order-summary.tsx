// File: components/shop/order-summary.tsx

"use client";

import { CartItem, useCart } from "@/lib/cart-store";
import { formatPrice } from "@/lib/utils";
import Image from "next/image";
import { CouponInput } from "./coupon-input";
import { Button } from "@/components/ui/Button";
import { X } from "lucide-react";
import { useSettings } from "@/components/providers/settings-provider";

interface OrderSummaryProps {
  items: CartItem[];
}

export function OrderSummary({ items }: OrderSummaryProps) {
  const { applyDiscount, removeDiscount, discount, getDiscountAmount } = useCart();
  const { settings } = useSettings();

  const subtotal = items.reduce((acc, item) => acc + item.price * item.quantity, 0);
  const discountAmount = getDiscountAmount();

  // Calculate tax on the discounted amount (standard practice)
  const taxableAmount = Math.max(0, subtotal - discountAmount);

  const taxRate = settings?.taxRate ?? 0;
  const freeShippingThreshold = settings?.freeShippingThreshold ?? Infinity;
  const shippingCost =
    taxableAmount >= freeShippingThreshold ? 0 : settings?.shippingCost ?? 0;

  const tax = taxableAmount * (taxRate / 100);
  const shipping = shippingCost;
  const total = taxableAmount + tax + shipping;

  return (
    <div className="bg-gray-50 dark:bg-gray-800 p-6 rounded-lg">
      <h2 className="text-xl font-bold mb-4">Order Summary</h2>
      <div className="space-y-4 mb-4 max-h-96 overflow-y-auto">
        {items.map((item) => (
          <div key={item.productId} className="flex gap-3">
            <div className="relative h-12 w-12">
              <Image
                src={item.image}
                alt={item.name}
                fill
                className="object-cover rounded"
              />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">{item.name}</p>
              <p className="text-xs text-gray-600 dark:text-gray-300">Qty: {item.quantity}</p>
            </div>
            <p className="text-sm font-medium">
              {formatPrice(item.price * item.quantity, settings?.currency)}
            </p>
          </div>
        ))}
      </div>

      <div className="border-t pt-4 mb-4">
        {!discount ? (
          <CouponInput
            onApplyCoupon={(d) => applyDiscount(d)}
            orderTotal={subtotal}
          />
        ) : (
          <div className="bg-green-50 border border-green-200 rounded-md p-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-green-800">
                Coupon applied: {discount.code}
              </p>
              <p className="text-xs text-green-600">
                {discount.type === "PERCENT"
                  ? `${discount.value}% off`
                  : `$${discount.value} off`}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={removeDiscount}
              className="h-8 w-8 p-0 text-green-800 hover:text-green-900 hover:bg-green-100"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>

      <div className="border-t pt-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span>Subtotal</span>
          <span>{formatPrice(subtotal, settings?.currency)}</span>
        </div>

        {discountAmount > 0 && (
          <div className="flex justify-between text-sm text-green-600 font-medium">
            <span>Discount</span>
            <span>-{formatPrice(discountAmount, settings?.currency)}</span>
          </div>
        )}

        <div className="flex justify-between text-sm">
          <span>Tax</span>
          <span>{formatPrice(tax, settings?.currency)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span>Shipping</span>
          <span>{formatPrice(shipping, settings?.currency)}</span>
        </div>
        <div className="flex justify-between text-lg font-bold border-t pt-2">
          <span>Total</span>
          <span>{formatPrice(total, settings?.currency)}</span>
        </div>
      </div>
    </div>
  );
}
