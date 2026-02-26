// app/(shop)/products/[slug]/page.tsx

import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import Image from "next/image";
import { ProductCard } from "@/components/shop/product-card";
import { AddToCartButton } from "@/components/shop/add-to-cart-button";
import { formatPrice } from "@/lib/utils";
import { Star } from "lucide-react";
import { ProductReviews } from "@/components/shop/product-reviews";
import { WishlistButton } from "@/components/ui/WishlistButton";

export const revalidate = 3600;

interface ProductPageProps {
  params: {
    slug: string;
  };
}

export async function generateMetadata({ params }: ProductPageProps) {
  const product = await db.product.findUnique({
    where: { slug: params.slug },
  });

  if (!product) {
    return {
      title: "Product Not Found",
    };
  }

  return {
    title: product.name,
    description: product.description,
    openGraph: {
      title: product.name,
      description: product.description,
      images: [
        {
          url: product.image,
          alt: product.name,
        },
      ],
    },
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const product = await db.product.findUnique({
    where: { slug: params.slug },
  });

  if (!product) {
    notFound();
  }

  // Get related products from same category
  const relatedProducts = await db.product.findMany({
    where: {
      category: product.category,
      isArchived: false,
      id: {
        not: product.id,
      },
    },
    take: 4,
  });

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Product Details */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
        {/* Product Image */}
        <div className="flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-lg h-96">
          <Image
            src={product.image}
            alt={product.name}
            width={500}
            height={500}
            className="object-cover w-full h-full rounded-lg"
            priority
          />
        </div>

        {/* Product Info */}
        <div className="space-y-6">
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {product.category}
            </p>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {product.name}
            </h1>
          </div>
          <p className="text-lg text-gray-700 dark:text-gray-300">
            {product.description}
          </p>
          <p className="text-xl font-semibold text-gray-900 dark:text-white">
            {formatPrice(product.price, product.currency)}
          </p>
          <div className="flex items-center space-x-2">
            <Star className="w-5 h-5 text-yellow-500" />
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {Number(product.rating)} / 5
            </span>
          </div>
          <AddToCartButton
            product={product}
            actionElement={<WishlistButton productId={product.id} />}
          />
        </div>
      </div>

      {/* Reviews */}
      <div className="mb-12">
        <ProductReviews productId={product.id} />
      </div>

      {/* Related Products */}
      <div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
          Related Products
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {relatedProducts.map((relatedProduct: any) => (
            <ProductCard key={relatedProduct.id} product={relatedProduct} />
          ))}
        </div>
      </div>
    </div>
  );
}

