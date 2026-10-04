import assert from "node:assert/strict";
import test from "node:test";
import { calculateCheckoutTotals } from "../lib/checkout-totals";
import { calculateStorefrontTotals, Discount } from "../lib/discounts";

test("main storefront matches actual checkout rounding, discounts, tax and shipping", () => {
  for (const currency of ["USD", "EUR", "JPY"]) {
    for (const price of [0.1, 19.99, 100, 600]) {
      for (const discount of [null, { type: "FIXED", value: 200 }, { type: "PERCENT", value: 5 },
        { type: "PERCENT", value: 15 }, { type: "PERCENT", value: 100 }] as Array<Discount | null>) {
        const settings = { currency, taxRate: 8.25, shippingCost: 5, freeShippingThreshold: 500 };
        const ui = calculateStorefrontTotals([{ price, quantity: 1 }], discount, settings);
        const server = calculateCheckoutTotals({ ...settings, subtotal: price, discount });
        for (const key of ["subtotal", "discountAmount", "tax", "shipping", "total"] as const) {
          assert.equal(ui[key], server[key].toNumber(), `${currency}, ${price}, ${JSON.stringify(discount)}, ${key}`);
        }
      }
    }
  }
});
