import assert from "node:assert/strict";
import test from "node:test";
import { moduleLoader } from "./helpers/load-module";

test("settings read returns defaults without mutating database", async () => {
  let writes = 0;
  const load = moduleLoader({
    "@/lib/db": { db: {
      storeSettings: {
        findFirst: async () => null,
        create: async () => { writes++; throw new Error("read must not write"); },
      },
    } },
    "@/lib/auth": { auth: async () => null },
    "next/cache": { revalidatePath() {} },
  });
  const result = await load("app/actions/settings.ts").getSettings();
  assert.equal(result.success, true);
  assert.equal(result.data.currency, "USD");
  assert.equal(result.data.paymentIban, null);
  assert.equal(writes, 0);
});

test("settings save accepts form values and persists IBAN with the free-shipping threshold", async () => {
  let written: any = null;
  const load = moduleLoader({
    "@/lib/db": { db: {
      storeSettings: { findFirst: async () => ({ id: "settings-1", currency: "USD" }) },
      $transaction: async (callback: any) => callback({
        storeSettings: { update: async ({ data }: any) => { written = data; } },
        product: { updateMany: async () => ({ count: 0 }) },
      }),
    } },
    "@/lib/auth": { auth: async () => ({ user: { role: "ADMIN" } }) },
    "next/cache": { revalidatePath() {} },
  });
  const result = await load("app/actions/settings.ts").updateSettings({
    currency: "eur",
    taxRate: 5,
    shippingCost: 10.5,
    freeShippingThreshold: 100,
    enabledCountries: [],
    enabledCategories: [],
    paymentIban: "DE001",
    paymentDetails: "Use the order number",
  });
  assert.equal(result.success, true);
  assert.equal(written.currency, "EUR");
  assert.equal(written.shippingCost, 10.5);
  assert.equal(written.freeShippingThreshold, 100);
  assert.equal(written.paymentIban, "DE001");
});

test("manual-order email is awaiting payment and never invents an unsigned guest link", () => {
  const templates = moduleLoader({ "@prisma/client": {} })("lib/email-templates.ts");
  const order = templates.buildOrderEmailView({
    id: "private-order-id", orderNumber: "#2030-1", currency: "EUR",
    subtotal: 10, discountAmount: 0, shippingCost: 0, tax: 0, total: 10,
    paymentIban: "DE001", items: [], shippingAddress: null,
  });
  const base = { order, storeName: "Store", supportEmail: "support@example.test" };
  const ownerHtml = templates.getOrderConfirmationEmailHtml({ ...base, orderUrl: "https://store.example.test/orders/private-order-id" });
  assert.match(ownerHtml, /bank transfer required/i);
  assert.doesNotMatch(ownerHtml, /Order Confirmed!/i);
  assert.match(ownerHtml, /https:\/\/store\.example\.test\/orders\/private-order-id/);

  const signedUrl = "https://store.example.test/orders/private-order-id?token=signed-secret-token";
  const guestHtml = templates.getOrderConfirmationEmailHtml({ ...base, orderUrl: signedUrl });
  assert.match(guestHtml, /token=signed-secret-token/);
  assert.doesNotMatch(guestHtml.replace(signedUrl, ""), /\/orders\/private-order-id/);

  const unlinked = templates.getOrderConfirmationEmailHtml({ ...base, orderUrl: null });
  assert.doesNotMatch(unlinked, /\/orders\/private-order-id/);
});
