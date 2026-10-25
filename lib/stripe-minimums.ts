// Pure module (safe for client components): Stripe's minimum charge amounts
// in minor units, from https://docs.stripe.com/currencies#minimum-and-maximum-charge-amounts
// Currencies not listed here have a minimum that depends on the account's
// settlement currency; for them the server relies on Stripe's
// `amount_too_small` error instead of a pre-check.
export const STRIPE_MINIMUM_CHARGE_MINOR: Readonly<Record<string, number>> = {
  USD: 50,
  AUD: 50,
  BRL: 50,
  CAD: 50,
  CHF: 50,
  CZK: 1500,
  DKK: 250,
  EUR: 50,
  GBP: 30,
  HKD: 400,
  HUF: 17500,
  INR: 50,
  JPY: 50,
  MXN: 1000,
  MYR: 200,
  NOK: 300,
  NZD: 50,
  PLN: 200,
  RON: 200,
  SEK: 300,
  SGD: 50,
  THB: 1000,
};

/** Minimum chargeable amount in minor units, or null when not known up front. */
export function stripeMinimumChargeMinor(currency: string): number | null {
  return STRIPE_MINIMUM_CHARGE_MINOR[currency.trim().toUpperCase()] ?? null;
}

/** True for a paid total that Stripe would reject as too small. Free orders (0) are allowed. */
export function isBelowStripeMinimum(totalMinor: number, currency: string): boolean {
  const minimum = stripeMinimumChargeMinor(currency);
  return minimum !== null && totalMinor > 0 && totalMinor < minimum;
}
