// File: app/(shop)/products/page.tsx

"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ProductGrid } from "@/components/shop/product-grid";
import { ProductFilters } from "@/components/shop/product-filters";
import Pagination from "@/components/admin/Pagination";
import {
  CATALOG_PAGE_SIZE,
  catalogApiQuery,
  catalogQueryString,
  readCatalogState,
  sameCatalogFilters,
  type CatalogFilters,
} from "@/lib/product-catalog";

const FILTER_DEBOUNCE_MS = 400;

function ProductsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // The URL is the source of truth for the applied filters and the page, so
  // pagination survives reloads, back/forward and shared links.
  const { filters: appliedFilters, page } = readCatalogState(searchParams);
  const appliedKey = catalogQueryString(appliedFilters, page);

  const [products, setProducts] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<CatalogFilters>(appliedFilters);

  const navigate = useCallback(
    (nextFilters: CatalogFilters, nextPage: number, replace: boolean) => {
      const query = catalogQueryString(nextFilters, nextPage);
      const url = query ? `${pathname}?${query}` : pathname;
      if (replace) router.replace(url, { scroll: false });
      else router.push(url, { scroll: false });
    },
    [pathname, router]
  );

  // URL -> inputs (navbar search, back/forward).
  useEffect(() => {
    setFilters((previous) => (sameCatalogFilters(previous, appliedFilters) ? previous : appliedFilters));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedKey]);

  // Inputs -> URL, debounced; changing a filter returns to the first page.
  useEffect(() => {
    if (sameCatalogFilters(filters, appliedFilters)) return;
    const timer = setTimeout(() => navigate(filters, 1, true), FILTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const fetchProducts = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/products?${catalogApiQuery(appliedFilters, page)}`);
        const data = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok || !data || !Array.isArray(data.products)) {
          throw new Error(data?.error || "Could not load products.");
        }
        const lastPage = Math.max(1, Math.ceil(data.total / CATALOG_PAGE_SIZE));
        if (data.products.length === 0 && data.total > 0 && page > lastPage) {
          navigate(appliedFilters, lastPage, true);
          return;
        }
        setProducts(data.products);
        setTotal(data.total);
        setError("");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load products.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchProducts();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedKey, reloadToken]);

  const totalPages = Math.max(1, Math.ceil(total / CATALOG_PAGE_SIZE));

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
        ) : error ? (
          <div role="alert" className="text-center py-12">
            <p className="text-red-600 mb-4">{error}</p>
            <button
              type="button"
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
              onClick={() => setReloadToken((token) => token + 1)}
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            <ProductGrid products={products} />
            <Pagination
              page={page}
              totalPages={totalPages}
              summary={`${total} products`}
              onPageChange={(nextPage) => {
                navigate(appliedFilters, nextPage, false);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          </>
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
