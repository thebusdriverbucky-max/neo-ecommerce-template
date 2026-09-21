import Stripe from "stripe";

export type ProductLineItemInput = {
  name: string;
  image?: string;
  unitAmountMinor: number;
  quantity: number;
};

function assertSafeMinorAmount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Stripe line-item amounts must be safe non-negative integers");
  }
}

/**
 * Allocates a discount over product lines only. Tax and shipping are passed as
 * separate lines by the caller, so a discount can never silently reduce them.
 * A line can be split into two prices when a discounted total is not divisible
 * by its quantity; the sum of all generated lines remains exact.
 */
export function buildDiscountedProductLineItems(
  currency: string,
  products: ProductLineItemInput[],
  discountMinor: number
): Stripe.Checkout.SessionCreateParams.LineItem[] {
  assertSafeMinorAmount(discountMinor);
  if (products.length === 0) return [];

  const lineTotals = products.map((product) => {
    if (!Number.isSafeInteger(product.unitAmountMinor) || product.unitAmountMinor <= 0) {
      throw new Error("Product unit amounts must be positive safe integers");
    }
    if (!Number.isInteger(product.quantity) || product.quantity <= 0) {
      throw new Error("Product quantities must be positive integers");
    }
    const lineTotal = product.unitAmountMinor * product.quantity;
    if (!Number.isSafeInteger(lineTotal)) {
      throw new Error("Product line total exceeds Stripe's safe integer limit");
    }
    return lineTotal;
  });
  const productTotalMinor = lineTotals.reduce((total, lineTotal) => total + lineTotal, 0);
  if (!Number.isSafeInteger(productTotalMinor)) {
    throw new Error("Product subtotal exceeds Stripe's safe integer limit");
  }
  if (discountMinor > productTotalMinor) {
    throw new Error("Discount cannot exceed the product subtotal");
  }

  // Allocate the integer remainder to the lines with the largest fractional
  // share. BigInt keeps the intermediate multiplication exact even when both
  // the subtotal and the discount are close to Stripe's safe integer limit.
  const discountBigInt = BigInt(discountMinor);
  const productTotalBigInt = BigInt(productTotalMinor);
  const allocations = lineTotals.map((lineTotal) => {
    const scaled = discountBigInt * BigInt(lineTotal);
    return {
      floor: Number(scaled / productTotalBigInt),
      remainder: scaled % productTotalBigInt,
    };
  });
  let allocatedDiscount = allocations.reduce((total, allocation) => total + allocation.floor, 0);
  let remainderUnits = discountMinor - allocatedDiscount;
  const remainderOrder = allocations
    .map((allocation, index) => ({ index, remainder: allocation.remainder }))
    .sort((left, right) => {
      if (left.remainder === right.remainder) return left.index - right.index;
      return left.remainder > right.remainder ? -1 : 1;
    });

  for (const { index } of remainderOrder) {
    if (remainderUnits === 0) break;
    if (allocations[index].floor < lineTotals[index]) {
      allocations[index].floor += 1;
      allocatedDiscount += 1;
      remainderUnits -= 1;
    }
  }

  if (allocatedDiscount !== discountMinor || remainderUnits !== 0) {
    throw new Error("Unable to allocate the complete discount across product lines");
  }

  return products.flatMap((product, index) => {
    const lineTotal = lineTotals[index];
    const lineDiscount = allocations[index].floor;
    const discountedLineTotal = lineTotal - lineDiscount;
    if (discountedLineTotal === 0) return [];

    const lowUnitAmount = Math.floor(discountedLineTotal / product.quantity);
    const highUnitCount = discountedLineTotal % product.quantity;
    const lowUnitCount = product.quantity - highUnitCount;
    const makeLine = (unitAmountMinor: number, quantity: number): Stripe.Checkout.SessionCreateParams.LineItem => ({
      price_data: {
        currency: currency.toLowerCase(),
        product_data: {
          name: product.name,
          ...(product.image ? { images: [product.image] } : {}),
        },
        unit_amount: unitAmountMinor,
      },
      quantity,
    });

    const lines: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
    if (lowUnitCount > 0 && lowUnitAmount > 0) {
      lines.push(makeLine(lowUnitAmount, lowUnitCount));
    }
    if (highUnitCount > 0) {
      lines.push(makeLine(lowUnitAmount + 1, highUnitCount));
    }
    return lines;
  });
}
