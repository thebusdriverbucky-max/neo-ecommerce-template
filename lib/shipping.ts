// Pure shipping rules shared by the storefront estimate and the server
// checkout. Must stay free of server-only imports (Prisma, Node APIs).
import { COUNTRIES } from "@/lib/constants";

/** Schema default applied when a database has no settings row yet. */
export const DEFAULT_FREE_SHIPPING_THRESHOLD = 500;

type ShippingSettings = { freeShippingThreshold?: number | null } | null | undefined;

/**
 * Items subtotal (before discounts) from which shipping is free.
 * - null: free shipping is disabled, shipping is always charged
 * - 0: every order ships free
 * A missing settings row falls back to the schema default.
 */
export function resolveFreeShippingThreshold(settings: ShippingSettings): number | null {
  if (!settings) return DEFAULT_FREE_SHIPPING_THRESHOLD;
  const threshold = settings.freeShippingThreshold;
  return threshold === undefined ? DEFAULT_FREE_SHIPPING_THRESHOLD : threshold;
}

const COUNTRY_CODES_BY_NAME = new Map(COUNTRIES.map((country) => [country.name.toLowerCase(), country.code]));
const COUNTRY_CODES = new Set(COUNTRIES.map((country) => country.code));

/** ISO code for a stored country value (settings store names, addresses codes). */
export function toCountryCode(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (COUNTRY_CODES.has(upper)) return upper;
  return COUNTRY_CODES_BY_NAME.get(trimmed.toLowerCase()) ?? null;
}

/** An empty list means every country is allowed. */
export function isCountryEnabled(country: string | null | undefined, enabledCountries: string[] | null | undefined): boolean {
  const code = toCountryCode(country);
  if (!code) return false;
  if (!enabledCountries || enabledCountries.length === 0) return true;
  return enabledCountries.some((entry) => toCountryCode(entry) === code);
}
