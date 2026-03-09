// File: components/shop/product-card.tsx

"use client";

import { Product } from "@prisma/client";
import Image from "next/image";
import Link from "next/link";
import { useCart } from "@/lib/cart-store";
import { ShoppingCart } from "lucide-react";
import { formatPrice } from "@/lib/utils";
import { CldImage } from 'next-cloudinary';
import { WishlistButton } from "@/components/ui/WishlistButton";
import { usePathname, useRouter } from "next/navigation";
import { useWishlist } from "@/lib/wishlist-store";
import { useSettings } from "@/components/providers/settings-provider";

interface ProductCardProps {
  product: Product;
}

export function ProductCard({ product }: ProductCardProps) {
  const { addItem } = useCart();
  const { currency } = useSettings();
  const pathname = usePathname();
  const router = useRouter();
  const { removeItem, items } = useWishlist();

  const handleAddToCart = async (e: React.MouseEvent) => {
    e.preventDefault();
    addItem({
      productId: product.id,
      name: product.name,
      price: parseFloat(product.price.toString()),
      image: product.image,
      quantity: 1,
      stock: product.stock,
    });

    if (pathname === "/wishlist" && items.includes(product.id)) {
      await removeItem(product.id);
      router.refresh();
    }
  };

  return (
    <Link href={`/products/${product.slug}`}>
      <div className="bg-sky-100/40 dark:bg-gray-800 rounded-lg overflow-hidden shadow hover:shadow-lg transition-shadow">
        <div className="relative h-64 w-full">
          <div className="absolute top-2 right-2 z-10">
            <WishlistButton productId={product.id} />
          </div>
          {product.image.startsWith('http') ? (
            <Image
              src={product.image}
              alt={product.name}
              fill
              className="object-cover"
            />
          ) : (
            <CldImage
              src={product.image}
              alt={product.name}
              fill
              className="object-cover"
            />
          )}
          {product.stock === 0 && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
              <span className="text-white font-bold">Out of Stock</span>
            </div>
          )}
        </div>
        <div className="p-4">
          <h3 className="font-bold text-lg truncate text-gray-900 dark:text-gray-100">{product.name}</h3>
          <p className="text-gray-600 dark:text-gray-400 text-sm mb-2 line-clamp-2 min-h-[2.5rem]">
            {product.description}
          </p>
          <div className="flex items-center justify-between">
            <span className="text-2xl font-bold text-blue-600">
              {formatPrice(product.price, currency)}
            </span>
            <button
              onClick={handleAddToCart}
              disabled={product.stock === 0}
              className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ShoppingCart className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </Link>
  );
}
