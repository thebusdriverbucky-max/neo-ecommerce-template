// components/shop/ProductDescription.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ChevronDown, ChevronUp } from "lucide-react";

interface ProductDescriptionProps {
  description: string;
}

export function ProductDescription({ description }: ProductDescriptionProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const shouldTruncate = description.length > 600;

  const displayedDescription = isExpanded || !shouldTruncate
    ? description
    : description.slice(0, 600) + "...";

  return (
    <div className="space-y-4">
      <div className="relative">
        <p className="text-lg text-gray-700 dark:text-gray-300 break-words whitespace-pre-wrap">
          {displayedDescription}
        </p>
        <div className="mt-4 border-b border-gray-200 dark:border-gray-800 w-full" />
      </div>

      {shouldTruncate && (
        <div className="flex justify-center -mt-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="bg-white dark:bg-gray-950 px-4 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            {isExpanded ? "Show less" : "Show more"}
          </Button>
        </div>
      )}
    </div>
  );
}
