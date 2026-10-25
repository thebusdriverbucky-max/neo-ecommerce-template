// Pure helpers for the storefront checkout page. Client-safe: no server-only imports.
import Decimal from "decimal.js";
import { moneyDecimals } from "@/lib/discounts";
import { isBelowStripeMinimum, stripeMinimumChargeMinor } from "@/lib/stripe-minimums";

/** Converts a major-unit amount (e.g. 12.34) to minor units for the currency. */
export function toMinorUnits(amount: number, currency: string): number {
  if (!Number.isFinite(amount)) return 0;
  return new Decimal(amount).mul(new Decimal(10).pow(moneyDecimals(currency)))
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

export type MinimumAmountNotice = { minimumMajor: number; currency: string };

/**
 * Returns the notice to show when a paid total is below what Stripe accepts,
 * or null (free orders, unknown currencies and sufficient totals).
 */
export function belowMinimumNotice(total: number, currency: string): MinimumAmountNotice | null {
  if (!isBelowStripeMinimum(toMinorUnits(total, currency), currency)) return null;
  const minimumMinor = stripeMinimumChargeMinor(currency);
  if (minimumMinor === null) return null;
  return {
    minimumMajor: new Decimal(minimumMinor).div(new Decimal(10).pow(moneyDecimals(currency))).toNumber(),
    currency,
  };
}

export type CheckoutFailure = {
  message: string;
  code?: string;
  paidOrder?: { orderId: string; guestAccessToken?: string };
};

const GENERIC_FAILURE = "Failed to create order";

/** Reads the { error, code, ... } body the orders API returns for non-OK responses. */
export function describeCheckoutFailure(body: unknown): CheckoutFailure {
  const data = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const message = typeof data.error === "string" && data.error.trim() ? data.error : GENERIC_FAILURE;
  const code = typeof data.code === "string" ? data.code : undefined;
  const failure: CheckoutFailure = { message, code };
  if (code === "PREVIOUS_CHECKOUT_PAID" && typeof data.orderId === "string" && data.orderId) {
    failure.paidOrder = {
      orderId: data.orderId,
      guestAccessToken: typeof data.guestAccessToken === "string" && data.guestAccessToken ? data.guestAccessToken : undefined,
    };
  }
  return failure;
}

/** Link to the order page; guests need their access token in the query. */
export function orderPagePath(orderId: string, guestAccessToken?: string): string {
  const base = `/orders/${encodeURIComponent(orderId)}`;
  return guestAccessToken ? `${base}?guest_token=${encodeURIComponent(guestAccessToken)}` : base;
}
