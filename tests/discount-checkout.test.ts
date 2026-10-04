import assert from "node:assert/strict";
import test from "node:test";
import { calculateOrderMoney, fromMinorUnits, toMinorUnits } from "../lib/order-money";
import { calculateStorefrontTotals, Discount } from "../lib/discounts";

test("Lite storefront matches bank-transfer discounts, tax and pre-discount shipping", () => {
  for (const currency of ["USD", "EUR", "JPY"]) {
    for (const price of [0.1, 19.99, 100, 600]) {
      for (const discount of [null, { type: "FIXED", value: 200 }, { type: "PERCENT", value: 5 },
        { type: "PERCENT", value: 15 }, { type: "PERCENT", value: 100 },
        { type: "PERCENT", value: 50, maxDiscount: 1.25 },
        { type: "PERCENT", value: 50, maxDiscount: 0 }] as Array<Discount | null>) {
        const settings = { currency, taxRate: 8.25, shippingCost: 5, freeShippingThreshold: 500 };
        const ui = calculateStorefrontTotals([{ price, quantity: 1 }], discount, settings, "subtotal");
        const server = calculateOrderMoney({
          lines: [{ unitPrice: price, quantity: 1 }],
          discount: discount ? { ...discount, maxDiscount: discount.maxDiscount == null ? null : String(discount.maxDiscount) } : null,
          taxRatePercent: settings.taxRate,
          shippingMinor: toMinorUnits(price >= settings.freeShippingThreshold ? 0 : settings.shippingCost),
        });
        for (const [key, minorKey] of [
          ["subtotal", "subtotalMinor"], ["discountAmount", "discountMinor"],
          ["tax", "taxMinor"], ["shipping", "shippingMinor"], ["total", "totalMinor"],
        ] as const) {
          assert.equal(ui[key], fromMinorUnits(server[minorKey]), `${currency}, ${price}, ${JSON.stringify(discount)}, ${key}`);
        }
      }
    }
  }
  assert.throws(() => calculateOrderMoney({ lines: [{ unitPrice: 100, quantity: 1 }],
    discount: { type: "PERCENT", value: 150 }, taxRatePercent: 0, shippingMinor: 0 }), /invalid/);
});
