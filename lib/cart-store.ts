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

/** A Stripe checkout this browser started and has not seen paid yet. */
export interface PendingCheckout {
  items: CheckoutCartItem[];
  guestAccessToken?: string;
  createdAt: number;
}

export interface PreviousCheckout {
  orderId: string;
  guestAccessToken?: string;
}

export const PENDING_CHECKOUT_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;
export const PENDING_CHECKOUT_MAX_ENTRIES = 5;
// Bump when the persisted shape changes; see migrateCartState.
const CART_STORE_VERSION = 1;

function toCheckoutItems(value: unknown): CheckoutCartItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const { productId, quantity } = (entry ?? {}) as Partial<CheckoutCartItem>;
    return typeof productId === "string" && typeof quantity === "number" ? [{ productId, quantity }] : [];
  });
}

/**
 * Accepts the current shape ({ items, guestAccessToken?, createdAt }) and the
 * legacy one (a bare item array); anything else is dropped. Legacy entries
 * have no timestamp, so they are stamped `now` and age out from here on.
 */
export function normalizePendingCheckout(value: unknown, now = Date.now()): PendingCheckout | null {
  if (Array.isArray(value)) return { items: toCheckoutItems(value), createdAt: now };
  if (!value || typeof value !== "object") return null;
  const entry = value as Partial<PendingCheckout>;
  const createdAt = typeof entry.createdAt === "number" && Number.isFinite(entry.createdAt) ? entry.createdAt : now;
  return {
    items: toCheckoutItems(entry.items),
    ...(typeof entry.guestAccessToken === "string" && entry.guestAccessToken ? { guestAccessToken: entry.guestAccessToken } : {}),
    createdAt,
  };
}

/** Normalizes every entry, drops expired ones and keeps only the newest few. */
export function prunePendingCheckouts(value: unknown, now = Date.now()): Record<string, PendingCheckout> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>).flatMap(([orderId, raw]) => {
    const entry = normalizePendingCheckout(raw, now);
    return entry && now - entry.createdAt <= PENDING_CHECKOUT_MAX_AGE_MS ? [[orderId, entry] as const] : [];
  });
  entries.sort((a, b) => b[1].createdAt - a[1].createdAt);
  return Object.fromEntries(entries.slice(0, PENDING_CHECKOUT_MAX_ENTRIES));
}

/** Payload for POST /api/orders `previousCheckouts`: most recent first, at most 5. */
export function buildPreviousCheckouts(pending: unknown, now = Date.now()): PreviousCheckout[] {
  return Object.entries(prunePendingCheckouts(pending, now))
    .sort((a, b) => b[1].createdAt - a[1].createdAt)
    .map(([orderId, entry]) => ({ orderId, ...(entry.guestAccessToken ? { guestAccessToken: entry.guestAccessToken } : {}) }));
}

/** Persist migration: version 0 stored pendingCheckouts as orderId -> items[]. */
export function migrateCartState(persisted: unknown, _version?: number): unknown {
  if (!persisted || typeof persisted !== "object") return persisted;
  return { ...persisted, pendingCheckouts: prunePendingCheckouts((persisted as { pendingCheckouts?: unknown }).pendingCheckouts) };
}

interface CartStore {
  items: CartItem[];
  discount: Discount | null;
  pendingCheckouts: Record<string, PendingCheckout>;
  rememberCheckout: (orderId: string, items: CheckoutCartItem[], guestAccessToken?: string) => void;
  forgetCheckouts: (orderIds: string[]) => void;
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
      rememberCheckout: (orderId, items, guestAccessToken) => set((state) => ({
        pendingCheckouts: prunePendingCheckouts({
          ...state.pendingCheckouts,
          [orderId]: {
            items: items.map(({ productId, quantity }) => ({ productId, quantity })),
            ...(guestAccessToken ? { guestAccessToken } : {}),
            createdAt: Date.now(),
          },
        }),
      })),
      forgetCheckouts: (orderIds) => set((state) => {
        const pendingCheckouts = { ...state.pendingCheckouts };
        for (const orderId of orderIds) delete pendingCheckouts[orderId];
        return { pendingCheckouts };
      }),
      completeCheckout: (orderId, purchased) => set((state) => {
        // Entries persisted by older versions are bare item arrays.
        const snapshot = normalizePendingCheckout(state.pendingCheckouts[orderId])?.items;
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
      version: CART_STORE_VERSION,
      migrate: (persisted, version) => migrateCartState(persisted, version) as CartStore,
    }
  )
);
