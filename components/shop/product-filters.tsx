// File: components/shop/product-filters.tsx

"use client";

import { useState } from "react";

interface ProductFiltersProps {
  filters: {
    category: string;
    minPrice: number;
    maxPrice: number;
    search: string;
  };
  setFilters: (filters: any) => void;
}

export function ProductFilters({ filters, setFilters }: ProductFiltersProps) {
  const categories = ["Electronics", "Clothing", "Home", "Sports"];

  return (
    <div className="space-y-6">
      {/* Search */}
      <div>
        <label className="block text-sm font-bold mb-2">Search</label>
        <input
          type="text"
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          placeholder="Search products..."
          className="w-full px-3 py-2 border border-gray-300 rounded-lg dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
        />
      </div>

      {/* Category */}
      <div>
        <label className="block text-sm font-bold mb-2">Category</label>
        <select
          value={filters.category}
          onChange={(e) => setFilters({ ...filters, category: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
        >
          <option value="">All Categories</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>

      {/* Price Range */}
      <div>
        <label className="block text-sm font-bold mb-2">Price Range</label>
        <div className="space-y-2">
          <input
            type="number"
            value={filters.minPrice}
            onChange={(e) =>
              setFilters({ ...filters, minPrice: parseFloat(e.target.value) })
            }
            placeholder="Min price"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
          />
          <input
            type="number"
            value={filters.maxPrice}
            onChange={(e) =>
              setFilters({ ...filters, maxPrice: parseFloat(e.target.value) })
            }
            placeholder="Max price"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
          />
        </div>
      </div>
    </div>
  );
}
