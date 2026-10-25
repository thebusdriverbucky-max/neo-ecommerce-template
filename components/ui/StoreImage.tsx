import Image, { type ImageProps } from "next/image";
import { isOptimizedImageSrc } from "@/lib/image-hosts";

/**
 * next/image for store content. Images on configured hosts (Cloudinary etc.)
 * are optimized; images pasted from any other HTTPS host load directly
 * instead of failing with "hostname is not configured".
 */
export function StoreImage({ unoptimized, alt, ...props }: ImageProps) {
  const src = typeof props.src === "string" ? props.src : null;
  const shouldSkipOptimizer = unoptimized ?? (src !== null && !isOptimizedImageSrc(src));
  return <Image {...props} alt={alt} unoptimized={shouldSkipOptimizer} />;
}
