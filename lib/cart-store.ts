// File: lib/cart-store.ts

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface CartItem {
  productId: string;
  name: string;
  price: number;
  image: string;
  quantity: number;
  stock: number;
}

export interface Discount {
  code: string;
  type: "PERCENT" | "FIXED";
  value: number;
}

interface CartStore {
  items: CartItem[];
  discount: Discount | null;
  addItem: (item: CartItem) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  applyDiscount: (discount: Discount) => void;
  removeDiscount: () => void;
  getTotalPrice: () => number;
  getDiscountAmount: () => number;
  getTotalItems: () => number;
}

export const useCart = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      discount: null,
      addItem: (item) => {
        if (item.stock <= 0) return;
        set((state) => {
          const existingItem = state.items.find(
            (i) => i.productId === item.productId
          );
          if (existingItem) {
            const newQuantity = existingItem.quantity + item.quantity;
            if (newQuantity > item.stock) {
              return {
                items: state.items.map((i) =>
                  i.productId === item.productId
                    ? { ...i, quantity: item.stock }
                    : i
                ),
              };
            }
            return {
              items: state.items.map((i) =>
                i.productId === item.productId
                  ? { ...i, quantity: newQuantity }
                  : i
              ),
            };
          }
          return { items: [...state.items, { ...item, quantity: 1 }] };
        });
      },
      removeItem: (productId) =>
        set((state) => ({
          items: state.items.filter((i) => i.productId !== productId),
        })),
      updateQuantity: (productId, quantity) => {
        set((state) => {
          const itemToUpdate = state.items.find((i) => i.productId === productId);
          if (!itemToUpdate) return state;

          let newQuantity = quantity;
          if (newQuantity > itemToUpdate.stock) {
            newQuantity = itemToUpdate.stock;
          }

          if (newQuantity <= 0) {
            return {
              items: state.items.filter((i) => i.productId !== productId),
            };
          }

          return {
            items: state.items.map((i) =>
              i.productId === productId ? { ...i, quantity: newQuantity } : i
            ),
          };
        });
      },
      clearCart: () => set({ items: [], discount: null }),
      applyDiscount: (discount) => set({ discount }),
      removeDiscount: () => set({ discount: null }),
      getDiscountAmount: () => {
        const { items, discount } = get();
        const subtotal = items.reduce((total, item) => total + item.price * item.quantity, 0);

        if (!discount) return 0;

        if (discount.type === "FIXED") {
          return Math.min(discount.value, subtotal);
        } else {
          return (subtotal * discount.value) / 100;
        }
      },
      getTotalPrice: () => {
        const { items } = get();
        const subtotal = items.reduce((total, item) => total + item.price * item.quantity, 0);
        const discountAmount = get().getDiscountAmount();
        return Math.max(0, subtotal - discountAmount);
      },
      getTotalItems: () =>
        get().items.reduce((total, item) => total + item.quantity, 0),
    }),
    {
      name: "cart-storage",
    }
  )
);
