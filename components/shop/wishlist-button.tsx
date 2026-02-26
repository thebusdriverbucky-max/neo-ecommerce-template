// components/shop/wishlist-button.tsx

"use client";

import { useState } from "react";
import { Heart } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useSession } from "next-auth/react";

interface WishlistButtonProps {
  productId: string;
  isWishlisted?: boolean;
}

export function WishlistButton({
  productId,
  isWishlisted = false,
}: WishlistButtonProps) {
  const { data: session } = useSession();
  const [wishlisted, setWishlisted] = useState(isWishlisted);
  const [loading, setLoading] = useState(false);

  const handleToggle = async () => {
    if (!session) {
      window.location.href = "/login";
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/wishlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          action: wishlisted ? "remove" : "add",
        }),
      });

      if (response.ok) {
        setWishlisted(!wishlisted);
      }
    } catch (error) {
      console.error("Wishlist action failed:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleToggle}
      disabled={loading}
      className="relative"
    >
      <Heart
        className={`w-6 h-6 transition-all ${wishlisted
            ? "fill-red-500 text-red-500"
            : "text-gray-600 dark:text-gray-400"
          }`}
      />
    </Button>
  );
}
