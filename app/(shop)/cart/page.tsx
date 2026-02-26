// File: app/(shop)/cart/page.tsx

"use client";

import { useCart } from "@/lib/cart-store";
import { CartItem } from "@/components/shop/cart-item";
import { CartSummary } from "@/components/shop/cart-summary";
import Link from "next/link";
import { useState, useEffect } from "react";

export default function CartPage() {
  const { items, getTotalPrice } = useCart();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mx-auto mb-4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2 mx-auto mb-8"></div>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <h1 className="text-3xl font-bold mb-4">Shopping Cart</h1>
        <p className="text-gray-600 mb-8">Your cart is empty</p>
        <Link
          href="/products"
          className="inline-block px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Continue Shopping
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">Shopping Cart</h1>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          {items.map((item) => (
            <CartItem key={item.productId} item={item} />
          ))}
        </div>
        <CartSummary />
      </div>
    </div>
  );
}
