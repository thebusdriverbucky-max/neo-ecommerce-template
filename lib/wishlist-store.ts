import { create } from 'zustand';

interface WishlistState {
  items: string[]; // productIds
  isLoading: boolean;
  isInitialized: boolean;
  fetchWishlist: () => Promise<void>;
  addItem: (productId: string) => Promise<void>;
  removeItem: (productId: string) => Promise<void>;
}

export const useWishlist = create<WishlistState>((set, get) => ({
  items: [],
  isLoading: false,
  isInitialized: false,
  fetchWishlist: async () => {
    set({ isLoading: true });
    try {
      const res = await fetch('/api/wishlist');
      if (res.ok) {
        const data = await res.json();
        // Assuming data is array of WishlistItem with productId
        const items = data.map((item: any) => item.productId);
        set({ items, isInitialized: true });
      }
    } catch (error) {
      console.error('Failed to fetch wishlist', error);
    } finally {
      set({ isLoading: false });
    }
  },
  addItem: async (productId: string) => {
    // Optimistic update
    const currentItems = get().items;
    if (!currentItems.includes(productId)) {
      set({ items: [...currentItems, productId] });
    }

    try {
      const res = await fetch('/api/wishlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId }),
      });
      if (!res.ok) {
        // Revert if failed
        set({ items: currentItems });
      }
    } catch (error) {
      set({ items: currentItems });
      console.error('Failed to add to wishlist', error);
    }
  },
  removeItem: async (productId: string) => {
    // Optimistic update
    const currentItems = get().items;
    set({ items: currentItems.filter(id => id !== productId) });

    try {
      const res = await fetch('/api/wishlist', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId }),
      });
      if (!res.ok) {
        // Revert
        set({ items: currentItems });
      }
    } catch (error) {
      set({ items: currentItems });
      console.error('Failed to remove from wishlist', error);
    }
  },
}));
