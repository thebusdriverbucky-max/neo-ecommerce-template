import { Prisma } from "@prisma/client";

/**
 * Stripe accepts integer amounts in the currency's smallest unit. The
 * database stores the corresponding major-unit value as Decimal, so all
 * arithmetic stays in Decimal until the Stripe boundary.
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

// Keep this list explicit. A currency not in this list must be configured in
// code before it can be used for real payments.
const SUPPORTED_CURRENCIES = new Set([
  "AUD",
  "BIF",
  "BRL",
  "CAD",
  "CHF",
  "CLP",
  "COP",
  "CZK",
  "DKK",
  "EUR",
  "GBP",
  "HKD",
  "HUF",
  "IDR",
  "ILS",
  "INR",
  "JPY",
  "KRW",
  "MXN",
  "MYR",
  "NOK",
  "NZD",
  "PHP",
  "PLN",
  "RON",
  "SEK",
  "SGD",
  "THB",
  "TRY",
  "TWD",
  "UAH",
  "UGX",
  "USD",
  "VND",
  "ZAR",
]);

export type DecimalInput = Prisma.Decimal | string | number;

export function normalizeCurrency(currency: string): string {
  const normalized = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized) || !SUPPORTED_CURRENCIES.has(normalized)) {
    throw new Error(`Unsupported Stripe currency: ${currency}`);
  }
  return normalized;
}

export function currencyExponent(currency: string): 0 | 2 {
  const normalized = normalizeCurrency(currency);
  return ZERO_DECIMAL_CURRENCIES.has(normalized) ? 0 : 2;
}

export function toDecimal(value: DecimalInput): Prisma.Decimal {
  const decimal = new Prisma.Decimal(value);
  if (!decimal.isFinite() || decimal.isNegative()) {
    throw new Error("Money value must be a finite, non-negative number");
  }
  return decimal;
}

export function roundMoney(value: DecimalInput, currency: string): Prisma.Decimal {
  return toDecimal(value).toDecimalPlaces(currencyExponent(currency));
}

export function toMinorUnits(value: DecimalInput, currency: string): number {
  const exponent = currencyExponent(currency);
  const minor = toDecimal(value).mul(new Prisma.Decimal(10).pow(exponent));

  if (!minor.isInteger()) {
    throw new Error(
      `Amount ${value} has more precision than ${currencyExponent(currency)} decimals for ${currency}`
    );
  }

  const result = minor.toNumber();
  if (!Number.isSafeInteger(result)) {
    throw new Error("Money value exceeds Stripe's safe integer limit");
  }
  return result;
}

export function fromMinorUnits(value: number, currency: string): Prisma.Decimal {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Minor-unit amount must be a safe non-negative integer");
  }
  return new Prisma.Decimal(value)
    .div(new Prisma.Decimal(10).pow(currencyExponent(currency)))
    .toDecimalPlaces(currencyExponent(currency));
}

export function percentOfMinorUnits(
  amountMinor: number,
  percentage: DecimalInput
): number {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new Error("Minor-unit amount must be a safe non-negative integer");
  }

  const result = new Prisma.Decimal(amountMinor)
    .mul(toDecimal(percentage))
    .div(100)
    .toDecimalPlaces(0)
    .toNumber();

  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error("Calculated amount exceeds Stripe's safe integer limit");
  }
  return result;
}

export function isZero(value: DecimalInput, currency: string): boolean {
  return toMinorUnits(value, currency) === 0;
}
