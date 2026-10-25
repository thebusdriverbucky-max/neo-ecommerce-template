// Pure helpers shared by the storefront catalog and the admin product list
// (URL <-> filter state, pagination). Safe for client components.

export const CATALOG_PAGE_SIZE = 12;

export interface CatalogFilters {
  category: string;
  minPrice: string;
  maxPrice: string;
  search: string;
}

export const EMPTY_CATALOG_FILTERS: CatalogFilters = { category: "", minPrice: "", maxPrice: "", search: "" };

type ParamReader = { get(name: string): string | null };

function finiteNumberText(value: string | null): string {
  if (value === null || value.trim() === "") return "";
  return Number.isFinite(Number(value)) ? value.trim() : "";
}

/** Reads the filters and the 1-based page number from a URL query. */
export function readCatalogState(params: ParamReader): { filters: CatalogFilters; page: number } {
  const page = Number(params.get("page"));
  return {
    filters: {
      category: params.get("category")?.trim() ?? "",
      minPrice: finiteNumberText(params.get("minPrice")),
      maxPrice: finiteNumberText(params.get("maxPrice")),
      search: params.get("search")?.trim() ?? "",
    },
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

/** Query string for the page URL; empty filters and page 1 are omitted. */
export function catalogQueryString(filters: CatalogFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.category) params.set("category", filters.category);
  if (finiteNumberText(filters.minPrice)) params.set("minPrice", filters.minPrice.trim());
  if (finiteNumberText(filters.maxPrice)) params.set("maxPrice", filters.maxPrice.trim());
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (page > 1) params.set("page", String(page));
  return params.toString();
}

/** Query string for GET /api/products (always paginated). */
export function catalogApiQuery(filters: CatalogFilters, page: number, pageSize = CATALOG_PAGE_SIZE): string {
  const params = new URLSearchParams(catalogQueryString(filters, 1));
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return params.toString();
}

export function sameCatalogFilters(a: CatalogFilters, b: CatalogFilters): boolean {
  return a.category === b.category && a.minPrice === b.minPrice && a.maxPrice === b.maxPrice && a.search === b.search;
}

/** Page buttons with ellipses, e.g. [1, "...", 4, 5, 6, "...", 20]. */
export function pageNumbers(page: number, totalPages: number): Array<number | "..."> {
  if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1);
  if (page <= 3) return [1, 2, 3, 4, "...", totalPages];
  if (page >= totalPages - 2) return [1, "...", totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  return [1, "...", page - 1, page, page + 1, "...", totalPages];
}
