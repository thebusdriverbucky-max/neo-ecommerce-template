// components/shop/ProductGallery.tsx
"use client";

import { useState } from "react";
import Image from "next/image";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface ProductGalleryProps {
  mainImage: string;
  images: string[];
  alt: string;
}

export function ProductGallery({ mainImage, images, alt }: ProductGalleryProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const allImages = [mainImage, ...(images || [])];
  const hasMore = images && images.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        {!isExpanded ? (
          <div className="flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-lg h-96">
            <Image
              src={mainImage}
              alt={alt}
              width={500}
              height={500}
              className="object-cover w-full h-full rounded-lg"
              priority
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {allImages.map((img, index) => (
              <div key={index} className="flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-lg h-96">
                <Image
                  src={img}
                  alt={`${alt} - ${index + 1}`}
                  width={500}
                  height={500}
                  className="object-cover w-full h-full rounded-lg"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {hasMore && (
        <div className="relative py-4">
          <div className="absolute inset-0 flex items-center" aria-hidden="true">
            <div className="w-full border-t border-gray-200 dark:border-gray-800"></div>
          </div>
          <div className="relative flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="rounded-full w-10 h-10 p-0 bg-white dark:bg-gray-950 border-gray-200 dark:border-gray-800 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              {isExpanded ? (
                <ChevronUp className="w-6 h-6" />
              ) : (
                <ChevronDown className="w-6 h-6" />
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
