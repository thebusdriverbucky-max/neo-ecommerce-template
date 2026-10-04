// File: lib/cart-store.ts

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { calculateDiscountAmount, discountAvailabilityError, Discount as DiscountRules } from "@/lib/discounts";

export interface CartItem {
  productId: string;
  name: string;
  price: number;
  image: string;
  quantity: number;
  stock: number;
}

export interface Discount extends DiscountRules {
  code: string;
  type: "PERCENT" | "FIXED";
  value: number;
}

export interface CheckoutCartItem {
  productId: string;
  quantity: number;
}

interface CartStore {
  items: CartItem[];
  discount: Discount | null;
  pendingCheckouts: Record<string, CheckoutCartItem[]>;
  rememberCheckout: (orderId: string, items: CheckoutCartItem[]) => void;
  completeCheckout: (orderId: string, purchased: CheckoutCartItem[]) => void;
  addItem: (item: CartItem) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  applyDiscount: (discount: Discount) => void;
  removeDiscount: () => void;
  getTotalPrice: () => number;
  getDiscountAmount: (currency?: string) => number;
  getTotalItems: () => number;
}

export const useCart = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      discount: null,
      pendingCheckouts: {},
      rememberCheckout: (orderId, items) => set((state) => ({
        pendingCheckouts: {
          ...state.pendingCheckouts,
          [orderId]: items.map(({ productId, quantity }) => ({ productId, quantity })),
        },
      })),
      completeCheckout: (orderId, purchased) => set((state) => {
        const snapshot = state.pendingCheckouts[orderId];
        // A server-authorized order must also belong to a checkout in this
        // browser. Revisiting an old order must never clear a new cart.
        if (!snapshot) return state;
        const pendingCheckouts = { ...state.pendingCheckouts };
        delete pendingCheckouts[orderId];
        const items = state.items.flatMap((item) => {
          const submitted = snapshot.find((entry) => entry.productId === item.productId);
          const confirmed = purchased.find((entry) => entry.productId === item.productId);
          const removed = Math.min(submitted?.quantity ?? 0, confirmed?.quantity ?? 0);
          const quantity = item.quantity - removed;
          return quantity > 0 ? [{ ...item, quantity }] : [];
        });
        return { items, pendingCheckouts, discount: items.length ? state.discount : null };
      }),
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
      clearCart: () => set({ items: [], discount: null, pendingCheckouts: {} }),
      applyDiscount: (discount) => set({ discount }),
      removeDiscount: () => set({ discount: null }),
      getDiscountAmount: (currency = "USD") => {
        const { items, discount } = get();
        const subtotal = items.reduce((total, item) => total + item.price * item.quantity, 0);

        if (!discount) return 0;

        if (discountAvailabilityError(discount, new Date(), subtotal)) return 0;
        return calculateDiscountAmount(subtotal, discount, currency);
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
