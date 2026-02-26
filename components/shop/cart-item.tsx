// File: components/shop/cart-item.tsx

"use client";
 
 import { CartItem as CartItemType, useCart } from "@/lib/cart-store";
 import Image from "next/image";
 import { Trash2, Plus, Minus } from "lucide-react";
 import { formatPrice } from "@/lib/utils";
 import { CldImage } from 'next-cloudinary';
 import { useEffect, useState } from "react";
 import { getSettings } from "@/app/actions/settings";
 
 interface CartItemProps {
   item: CartItemType;
 }
 
 export function CartItem({ item }: CartItemProps) {
   const { updateQuantity, removeItem } = useCart();
   const [currency, setCurrency] = useState<string>("USD");

   useEffect(() => {
     async function fetchSettings() {
       const response = await getSettings();
       if (response.success && response.data) {
         setCurrency(response.data.currency);
       }
     }
     fetchSettings();
   }, []);

  return (
    <div className="flex gap-4 p-4 border border-gray-200 rounded-lg mb-4">
      <div className="relative h-24 w-24">
        {item.image.startsWith('http') ? (
          <Image
            src={item.image}
            alt={item.name}
            fill
            className="object-cover rounded"
          />
        ) : (
          <CldImage
            src={item.image}
            alt={item.name}
            fill
            crop={{ type: 'thumb', source: true }}
            className="object-cover rounded"
          />
        )}
      </div>
      <div className="flex-1">
         <h3 className="font-bold">{item.name}</h3>
         <p className="text-gray-600 dark:text-gray-300">{formatPrice(item.price, currency)}</p>
         <div className="flex items-center gap-2 mt-2">
          <button
            onClick={() => updateQuantity(item.productId, item.quantity - 1)}
            className="p-1 hover:bg-gray-200 rounded"
          >
            <Minus className="w-4 h-4" />
          </button>
          <span className="w-8 text-center">{item.quantity}</span>
          <button
            onClick={() => updateQuantity(item.productId, item.quantity + 1)}
            className="p-1 hover:bg-gray-200 rounded"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="flex flex-col items-end justify-between">
         <p className="font-bold text-lg">
           {formatPrice(item.price * item.quantity, currency)}
         </p>
         <button
          onClick={() => removeItem(item.productId)}
          className="p-1 text-red-600 hover:bg-red-50 rounded"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
