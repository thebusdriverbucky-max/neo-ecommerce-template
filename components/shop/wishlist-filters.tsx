"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";

export function WishlistFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [q, setQ] = useState(searchParams.get("q") || "");
  const [sort, setSort] = useState(searchParams.get("sort") || "desc");

  // Update URL when filters change
  useEffect(() => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (sort) params.set("sort", sort);

    router.push(`/wishlist?${params.toString()}`);
  }, [q, sort, router]);

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-bold mb-2">Search</label>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search wishlist..."
          className="w-full px-3 py-2 border border-gray-300 rounded-lg dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
        />
      </div>

      <div>
        <label className="block text-sm font-bold mb-2">Sort By</label>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
        >
          <option value="desc">Newest First</option>
          <option value="asc">Oldest First</option>
          <option value="price_asc">Price: Low to High</option>
          <option value="price_desc">Price: High to Low</option>
        </select>
      </div>
    </div>
  );
}

