// File: components/shop/product-filters.tsx

"use client";

import { useSettings } from "@/components/providers/settings-provider";
import { DEFAULT_CATEGORIES } from "@/lib/constants";
import type { CatalogFilters } from "@/lib/product-catalog";

interface ProductFiltersProps {
  filters: CatalogFilters;
  setFilters: (filters: CatalogFilters) => void;
}

export function ProductFilters({ filters, setFilters }: ProductFiltersProps) {
  const { settings } = useSettings();
  const enabled = settings?.enabledCategories;
  const configured = enabled && enabled.length > 0 ? enabled : DEFAULT_CATEGORIES;
  // Keep a category from the URL selectable even if it was disabled later.
  const categories = filters.category && !configured.includes(filters.category)
    ? [...configured, filters.category]
    : configured;

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
            min="0"
            value={filters.minPrice}
            onChange={(e) => setFilters({ ...filters, minPrice: e.target.value })}
            placeholder="Min price"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
          />
          <input
            type="number"
            min="0"
            value={filters.maxPrice}
            onChange={(e) => setFilters({ ...filters, maxPrice: e.target.value })}
            placeholder="Max price"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
          />
        </div>
      </div>
    </div>
  );
}
