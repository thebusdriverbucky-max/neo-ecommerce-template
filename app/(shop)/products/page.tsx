// File: app/(shop)/products/page.tsx

"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { db } from "@/lib/db";
import { ProductGrid } from "@/components/shop/product-grid";
import { ProductFilters } from "@/components/shop/product-filters";

function ProductsContent() {
  const searchParams = useSearchParams();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    category: "",
    minPrice: 0,
    maxPrice: 10000,
    search: "",
  });

  useEffect(() => {
    const search = searchParams.get("search") || "";
    setFilters((prev) => {
      if (prev.search === search) return prev;
      return { ...prev, search };
    });
  }, [searchParams]);

  useEffect(() => {
    const fetchProducts = async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/products?${new URLSearchParams({
            category: filters.category,
            minPrice: filters.minPrice.toString(),
            maxPrice: filters.maxPrice.toString(),
            search: filters.search,
          })}`
        );
        const data = await response.json();
        setProducts(data);
      } catch (error) {
        console.error("Failed to fetch products:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchProducts();
  }, [filters]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 items-start">
      <div className="lg:sticky lg:top-24">
        <ProductFilters filters={filters} setFilters={setFilters} />
      </div>
      <div className="lg:col-span-3">
        {loading ? (
          <div className="flex justify-center items-center h-96">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-blue-600"></div>
          </div>
        ) : (
          <ProductGrid products={products} />
        )}
      </div>
    </div>
  );
}

export default function ProductsPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">Products</h1>
      <Suspense fallback={
        <div className="flex justify-center items-center h-96">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-blue-600"></div>
        </div>
      }>
        <ProductsContent />
      </Suspense>
    </div>
  );
}
