"use client";

import { Heart } from "lucide-react";
import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useWishlist } from "@/lib/wishlist-store";

interface WishlistButtonProps {
  productId: string;
}

export function WishlistButton({ productId }: WishlistButtonProps) {
  const { data: session } = useSession();
  const router = useRouter();
  const { items, addItem, removeItem, fetchWishlist, isInitialized } = useWishlist();

  useEffect(() => {
    if (session?.user && !isInitialized) {
      fetchWishlist();
    }
  }, [session, isInitialized, fetchWishlist]);

  const isInWishlist = items.includes(productId);

  const toggleWishlist = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!session) {
      router.push("/login");
      return;
    }

    if (isInWishlist) {
      await removeItem(productId);
    } else {
      await addItem(productId);
    }
    router.refresh();
  };

  return (
    <button
      onClick={toggleWishlist}
      className={`p-2 rounded-full transition-colors ${isInWishlist
          ? "text-red-500 hover:bg-red-50"
          : "text-gray-400 hover:text-red-500 hover:bg-gray-100"
        }`}
      aria-label={isInWishlist ? "Remove from wishlist" : "Add to wishlist"}
    >
      <Heart
        className={`w-6 h-6 ${isInWishlist ? "fill-current" : ""}`}
      />
    </button>
  );
}

