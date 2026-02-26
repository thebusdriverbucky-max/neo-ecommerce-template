import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { ProductGrid } from "@/components/shop/product-grid";
import { WishlistFilters } from "@/components/shop/wishlist-filters";
import { Suspense } from "react";

export default async function WishlistPage({
  searchParams,
}: {
  searchParams: { q?: string; sort?: string };
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const q = searchParams.q || "";
  const sort = searchParams.sort || "desc";

  // Determine sorting logic
  let orderBy: any = { createdAt: "desc" };
  if (sort === "asc") {
    orderBy = { createdAt: "asc" };
  } else if (sort === "price_asc") {
    orderBy = { product: { price: "asc" } };
  } else if (sort === "price_desc") {
    orderBy = { product: { price: "desc" } };
  }

  const wishlistItems = await db.wishlist.findMany({
    where: {
      userId: session.user.id,
      ...(q
        ? {
          product: {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
            ],
          },
        }
        : {}),
    },
    include: {
      product: true,
    },
    orderBy,
  });

  const products = wishlistItems.map((item) => item.product);

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">My Wishlist</h1>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 items-start">
        <div className="lg:sticky lg:top-24">
          <Suspense fallback={<div className="animate-pulse h-32 bg-gray-100 rounded-lg"></div>}>
            <WishlistFilters />
          </Suspense>
        </div>
        <div className="lg:col-span-3">
          <ProductGrid products={products} />
        </div>
      </div>
    </div>
  );
}
