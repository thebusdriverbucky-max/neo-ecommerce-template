// components/admin/Pagination.tsx
"use client";

import { Button } from "@/components/ui/Button";
import { pageNumbers } from "@/lib/product-catalog";

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** Optional text under the buttons, e.g. "42 orders". */
  summary?: string;
  disabled?: boolean;
}

export default function Pagination({ page, totalPages, onPageChange, summary, disabled }: PaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <nav aria-label="Pagination" className="mt-6 flex flex-col items-center gap-4">
      <div className="flex flex-wrap justify-center gap-1 items-center">
        <Button variant="outline" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={disabled || page === 1}>
          &larr; Prev
        </Button>

        {pageNumbers(page, totalPages).map((entry, index) =>
          entry === "..." ? (
            <span key={`ellipsis-${index}`} className="px-2 text-gray-500">
              ...
            </span>
          ) : (
            <Button
              key={entry}
              variant={page === entry ? "default" : "outline"}
              onClick={() => onPageChange(entry)}
              disabled={disabled}
              aria-current={page === entry ? "page" : undefined}
              className={page === entry ? "font-bold" : ""}
            >
              {entry}
            </Button>
          ),
        )}

        <Button
          variant="outline"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={disabled || page === totalPages}
        >
          Next &rarr;
        </Button>
      </div>
      <div className="text-sm text-gray-500">
        Page {page} of {totalPages}
        {summary ? ` (${summary})` : ""}
      </div>
    </nav>
  );
}
