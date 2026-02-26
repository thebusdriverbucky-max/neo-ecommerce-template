// File: lib/utils.ts

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPrice(price: number | string | any, currency?: string): string {
  const numPrice = parseFloat(String(price));
  const displayCurrency = currency || "USD";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: displayCurrency,
    }).format(numPrice);
  } catch (error) {
    console.error("Error formatting price:", error);
    return `${displayCurrency} ${numPrice.toFixed(2)}`;
  }
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

export function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export function sanitizeInput(input: string): string {
  return input
    .trim()
    .replace(/[<>\"']/g, "")
    .substring(0, 500);
}
