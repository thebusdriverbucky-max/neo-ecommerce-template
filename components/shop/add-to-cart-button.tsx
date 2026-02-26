// components/shop/add-to-cart-button.tsx

"use client";

import { Product } from "@prisma/client";
import { useCart } from "@/lib/cart-store";
import { Button } from "@/components/ui/Button";
import { ShoppingCart } from "lucide-react";
import { useState } from "react";

interface AddToCartButtonProps {
  product: Product;
  actionElement?: React.ReactNode;
}

export function AddToCartButton({ product, actionElement }: AddToCartButtonProps) {
  const { addItem } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const [isAdding, setIsAdding] = useState(false);

  const handleAddToCart = async () => {
    setIsAdding(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 500)); // Simulate network delay
      addItem({
        productId: product.id,
        name: product.name,
        price: parseFloat(product.price.toString()),
        image: product.image,
        quantity,
        stock: product.stock,
      });

      setAdded(true);
      setTimeout(() => setAdded(false), 2000);
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div className="space-y-4 w-full">
      <div className="flex items-center gap-4">
        <div className="flex items-center border border-gray-300 rounded-lg">
          <button
            onClick={() => setQuantity(Math.max(1, quantity - 1))}
            className="px-4 py-2 hover:bg-gray-100"
          >
            −
          </button>
          <input
            type="number"
            min="1"
            max={product.stock}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-16 text-center border-l border-r border-gray-300 py-2 focus:outline-none"
          />
          <button
            onClick={() => setQuantity(Math.min(product.stock, quantity + 1))}
            className="px-4 py-2 hover:bg-gray-100"
          >
            +
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <Button
          size="lg"
          onClick={handleAddToCart}
          disabled={isAdding || product.stock === 0}
          className="w-full gap-2"
        >
          {isAdding ? (
            <>
              <svg
                className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              Adding...
            </>
          ) : (
            <>
              <ShoppingCart className="w-5 h-5" />
              {added ? "Added to Cart!" : "Add to Cart"}
            </>
          )}
        </Button>
        {actionElement}
      </div>
    </div>
  );
}
