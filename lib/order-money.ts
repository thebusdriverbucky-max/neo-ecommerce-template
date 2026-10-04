import Decimal from "decimal.js";
import { calculateDiscountAmount } from "./discounts";

export type DiscountInput = {
  type: "FIXED" | "PERCENT";
  value: number | string;
  maxDiscount?: number | string | null;
};

export type OrderMoney = {
  subtotalMinor: number;
  discountMinor: number;
  taxableMinor: number;
  taxMinor: number;
  shippingMinor: number;
  totalMinor: number;
};

const MAX_SAFE_MINOR = 100_000_000;

export function toMinorUnits(value: number | string): number {
  const normalized = typeof value === "number" ? String(value) : value.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) throw new Error("Invalid money value");
  const negative = normalized.startsWith("-");
  const [whole, fraction = ""] = normalized.replace("-", "").split(".");
  const third = Number(fraction[2] || "0");
  let minor = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  if (third >= 5) minor += 1;
  minor = negative ? -minor : minor;
  if (!Number.isSafeInteger(minor) || Math.abs(minor) > MAX_SAFE_MINOR) {
    throw new Error("Money value is outside the supported range");
  }
  return minor;
}

export function fromMinorUnits(value: number): number {
  if (!Number.isSafeInteger(value)) throw new Error("Minor units must be an integer");
  return value / 100;
}

export function calculateOrderMoney(input: {
  lines: Array<{ unitPrice: number | string; quantity: number }>;
  discount?: DiscountInput | null;
  taxRatePercent: number;
  shippingMinor: number;
}): OrderMoney {
  const subtotalMinor = input.lines.reduce((total, line) => {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 100) {
      throw new Error("Invalid quantity");
    }
    return total + toMinorUnits(line.unitPrice) * line.quantity;
  }, 0);

  let discountMinor = 0;
  if (input.discount) {
    discountMinor = toMinorUnits(calculateDiscountAmount(fromMinorUnits(subtotalMinor), {
      type: input.discount.type, value: Number(input.discount.value), maxDiscount: input.discount.maxDiscount,
    }));
  }

  const taxableMinor = subtotalMinor - discountMinor;
  if (!Number.isFinite(input.taxRatePercent) || input.taxRatePercent < 0 || input.taxRatePercent > 100) {
    throw new Error("Invalid tax rate");
  }
  if (!Number.isSafeInteger(input.shippingMinor) || input.shippingMinor < 0) {
    throw new Error("Invalid shipping amount");
  }
  const taxMinor = new Decimal(taxableMinor).mul(input.taxRatePercent).div(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  const totalMinor = taxableMinor + taxMinor + input.shippingMinor;
  if (!Number.isSafeInteger(totalMinor) || totalMinor > MAX_SAFE_MINOR) throw new Error("Order total is outside the supported range");

  return { subtotalMinor, discountMinor, taxableMinor, taxMinor, shippingMinor: input.shippingMinor, totalMinor };
}
