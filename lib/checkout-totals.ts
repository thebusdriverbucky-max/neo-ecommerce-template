import { Prisma } from "@prisma/client";
import { DecimalInput, roundMoney, toDecimal, toMinorUnits } from "@/lib/money";

export type CheckoutDiscount = {
  type: "FIXED" | "PERCENT";
  value: DecimalInput;
};

export type CheckoutTotalsInput = {
  currency: string;
  subtotal: DecimalInput;
  discount?: CheckoutDiscount | null;
  taxRate: DecimalInput;
  shippingCost: DecimalInput;
  freeShippingThreshold: DecimalInput;
};

export type CheckoutTotals = {
  subtotal: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  discountedSubtotal: Prisma.Decimal;
  tax: Prisma.Decimal;
  shipping: Prisma.Decimal;
  total: Prisma.Decimal;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  shippingMinor: number;
  totalMinor: number;
};

export function calculateCheckoutTotals(input: CheckoutTotalsInput): CheckoutTotals {
  const subtotal = roundMoney(input.subtotal, input.currency);
  const taxRate = toDecimal(input.taxRate);
  const shippingCost = toDecimal(input.shippingCost);
  const freeShippingThreshold = toDecimal(input.freeShippingThreshold);

  if (taxRate.gt(100)) throw new Error("Tax rate cannot exceed 100 percent");

  let discountAmount = new Prisma.Decimal(0);
  if (input.discount) {
    const discountValue = toDecimal(input.discount.value);
    if (input.discount.type === "PERCENT" && discountValue.gt(100)) {
      throw new Error("Percentage discount cannot exceed 100 percent");
    }
    discountAmount = input.discount.type === "FIXED"
      ? discountValue
      : subtotal.mul(discountValue).div(100);
    discountAmount = roundMoney(Prisma.Decimal.min(discountAmount, subtotal), input.currency);
  }

  const discountedSubtotal = roundMoney(subtotal.sub(discountAmount), input.currency);
  const tax = roundMoney(discountedSubtotal.mul(taxRate).div(100), input.currency);
  const shipping = roundMoney(
    discountedSubtotal.gte(freeShippingThreshold) ? 0 : shippingCost,
    input.currency
  );
  const total = roundMoney(discountedSubtotal.add(tax).add(shipping), input.currency);

  return {
    subtotal,
    discountAmount,
    discountedSubtotal,
    tax,
    shipping,
    total,
    subtotalMinor: toMinorUnits(subtotal, input.currency),
    discountMinor: toMinorUnits(discountAmount, input.currency),
    taxMinor: toMinorUnits(tax, input.currency),
    shippingMinor: toMinorUnits(shipping, input.currency),
    totalMinor: toMinorUnits(total, input.currency),
  };
}
