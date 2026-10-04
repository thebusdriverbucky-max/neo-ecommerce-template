import Decimal from "decimal.js";
import { z } from "zod";

export const MAX_DISCOUNT_VALUE = 1_000_000;

export const discountCodeSchema = z.string().trim().toUpperCase()
  .min(1, "Enter a discount code").max(50, "Code must be at most 50 characters")
  .regex(/^\S+$/, "Codes cannot contain spaces");

const discountValueSchema = z.union([
  z.number(),
  z.string().trim().min(1, "Enter a discount value").transform(Number),
]).pipe(z.number({ error: "Enter a valid discount value" }).finite()
  .positive("Discount must be greater than zero")
  .max(MAX_DISCOUNT_VALUE, "Discount cannot exceed 1,000,000")
  .refine(value => new Decimal(value).decimalPlaces() <= 2, "Use at most 2 decimal places"));

// Date-only admin input means the last valid day, explicitly in UTC.
// Existing ISO timestamps retain their exact instant; no timezone/year guessing.
const discountExpirySchema = z.union([z.iso.date(), z.iso.datetime({ offset: true })])
  .refine(value => Number(value.slice(0, 4)) >= 1000, "Enter a four-digit year")
  .nullable().optional()
  .transform(value => value ? new Date(value.length === 10 ? `${value}T23:59:59.999Z` : value) : null);

export const discountSchema = z.object({
  code: discountCodeSchema.pipe(z.string().min(2, "Code must be at least 2 characters")),
  type: z.enum(["FIXED", "PERCENT"]),
  value: discountValueSchema,
  isActive: z.boolean().default(true),
  expiresAt: discountExpirySchema,
}).refine(data => data.type !== "PERCENT" || data.value <= 100, {
  message: "Percentage cannot exceed 100", path: ["value"],
});

export const discountLookupSchema = z.object({
  code: discountCodeSchema,
  orderAmount: z.number().finite().nonnegative().max(99_999_999.99).optional(),
});

export const couponLookupSchema = discountLookupSchema.required({ orderAmount: true });

export type Discount = {
  type: "FIXED" | "PERCENT";
  value: number;
  isActive?: boolean;
  expiresAt?: Date | string | null;
  minAmount?: { toString(): string } | number | string | null;
  maxDiscount?: { toString(): string } | number | string | null;
  usageLimit?: number | null;
  used?: number;
};

export function discountConfigurationError(discount: Discount): string | null {
  if (!["FIXED", "PERCENT"].includes(discount.type) || !Number.isFinite(discount.value)
    || discount.value <= 0 || discount.value > MAX_DISCOUNT_VALUE
    || (discount.type === "PERCENT" && discount.value > 100)) {
    return "The discount configuration is invalid";
  }
  for (const amount of [discount.minAmount, discount.maxDiscount]) {
    if (amount == null) continue;
    try {
      const value = new Decimal(String(amount));
      if (!value.isFinite() || value.isNegative()) return "The discount configuration is invalid";
    } catch {
      return "The discount configuration is invalid";
    }
  }
  if (discount.usageLimit != null && (!Number.isSafeInteger(discount.usageLimit) || discount.usageLimit < 1)) {
    return "The discount configuration is invalid";
  }
  return null;
}

export function discountAvailabilityError(discount: Discount, now = new Date(), subtotal?: number): string | null {
  const invalid = discountConfigurationError(discount);
  if (invalid) return invalid;
  if (discount.isActive === false) return "Discount code is inactive";
  if (discount.expiresAt != null) {
    const expiresAt = new Date(discount.expiresAt).getTime();
    if (!Number.isFinite(expiresAt)) return "The discount configuration is invalid";
    if (expiresAt <= now.getTime()) return "Discount code has expired";
  }
  if (discount.usageLimit != null && (discount.used ?? 0) >= discount.usageLimit) {
    return "Discount usage limit has been reached";
  }
  if (subtotal !== undefined && discount.minAmount != null && new Decimal(subtotal).lt(String(discount.minAmount))) {
    return "Order does not meet the discount minimum";
  }
  return null;
}

const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF",
  "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);

export function moneyDecimals(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2;
}

export function calculateDiscountAmount(subtotal: number | string, discount: Discount | null, currency = "USD"): number {
  const base = new Decimal(subtotal).toDecimalPlaces(moneyDecimals(currency), Decimal.ROUND_HALF_UP);
  if (!base.isFinite() || base.isNegative()) throw new Error("Invalid subtotal");
  if (!discount) return 0;
  const invalid = discountConfigurationError(discount);
  if (invalid) throw new Error(invalid);
  let amount = discount.type === "FIXED" ? new Decimal(discount.value) : base.mul(discount.value).div(100);
  if (discount.maxDiscount != null) amount = Decimal.min(amount, String(discount.maxDiscount));
  return Decimal.min(base, amount).toDecimalPlaces(moneyDecimals(currency), Decimal.ROUND_HALF_UP).toNumber();
}

export type PricingSettings = {
  currency?: string;
  taxRate?: number | null;
  shippingCost?: number | null;
  freeShippingThreshold?: number | null;
};

// Estimates round in the same order as checkout. The server still re-reads
// product prices and discount availability before creating an order.
export function calculateStorefrontTotals(
  items: Array<{ price: number; quantity: number }>,
  discount: Discount | null,
  settings: PricingSettings | null,
  shippingBasis: "discounted" | "subtotal" = "discounted",
) {
  const currency = settings?.currency || "USD";
  // Lite's existing order-money engine uses cents for all supported currencies.
  const roundingCurrency = shippingBasis === "subtotal" ? "USD" : currency;
  const decimals = moneyDecimals(roundingCurrency);
  const round = (value: Decimal) => value.toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP);
  const subtotal = round(items.reduce((sum, item) => sum.add(round(new Decimal(item.price)).mul(item.quantity)), new Decimal(0)));
  const discountError = discount ? discountAvailabilityError(discount, new Date(), subtotal.toNumber()) : null;
  const discountAmount = calculateDiscountAmount(subtotal.toString(), discountError ? null : discount, roundingCurrency);
  const discountedSubtotal = round(subtotal.sub(discountAmount));
  const tax = round(discountedSubtotal.mul(settings?.taxRate ?? 0).div(100));
  const thresholdBase = shippingBasis === "subtotal" ? subtotal : discountedSubtotal;
  const shipping = round(new Decimal(thresholdBase.gte(settings?.freeShippingThreshold ?? (shippingBasis === "subtotal" ? 0 : 500))
    ? 0 : settings?.shippingCost ?? 0));
  return {
    subtotal: subtotal.toNumber(), discountAmount, discountError,
    tax: tax.toNumber(), shipping: shipping.toNumber(),
    total: round(discountedSubtotal.add(tax).add(shipping)).toNumber(),
  };
}

export function publicDiscount(discount: Discount & { code: string }) {
  return {
    code: discount.code, type: discount.type, value: discount.value,
    expiresAt: discount.expiresAt ?? null,
    minAmount: discount.minAmount == null ? null : Number(String(discount.minAmount)),
    maxDiscount: discount.maxDiscount == null ? null : Number(String(discount.maxDiscount)),
  };
}
