"use client";

import { Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";

export function SearchInput() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    // Sync local state with URL search param
    const query = searchParams.get("search");
    if (query) {
      setSearchQuery(query);
    }
  }, [searchParams]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();

    const params = new URLSearchParams(searchParams.toString());

    if (searchQuery.trim()) {
      params.set("search", searchQuery.trim());
    } else {
      params.delete("search");
    }

    // Always navigate to products page with the search query
    router.push(`/products?${params.toString()}`);
  };

  return (
    <form onSubmit={handleSearch} className="relative hidden md:block w-64 lg:w-80">
      <input
        type="text"
        placeholder="Search products..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="w-full pl-10 pr-4 py-2 rounded-full border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />
      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
    </form>
  );
}

