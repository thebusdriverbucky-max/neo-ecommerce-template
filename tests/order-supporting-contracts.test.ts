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

test("settings save accepts numeric form values and persists IBAN with the free-shipping threshold", async () => {
  let written: any = null;
  const load = moduleLoader({
    "@/lib/db": { db: {
      storeSettings: { findFirst: async () => ({ id: "settings-1" }) },
      $transaction: async (callback: any) => callback({
        storeSettings: { update: async ({ data }: any) => { written = data; } },
      }),
    } },
    "@/lib/auth": { auth: async () => ({ user: { role: "ADMIN" } }) },
    "next/cache": { revalidatePath() {} },
  });
  const result = await load("app/actions/settings.ts").updateSettings({
    currency: "eur",
    taxRate: "5" as any,
    shippingCost: "10.50" as any,
    freeShippingThreshold: "100" as any,
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
  const base = {
    orderNumber: "#2030-1",
    orderId: "private-order-id",
    total: 10,
    items: [],
    storeName: "Store",
    supportEmail: "support@example.test",
    storeUrl: "https://store.example.test",
    paymentIban: "DE001",
  };
  const ownerHtml = templates.getOrderConfirmationEmailHtml(base);
  assert.match(ownerHtml, /awaiting bank transfer/i);
  assert.doesNotMatch(ownerHtml, /Order Confirmed!/i);
  assert.match(ownerHtml, /https:\/\/store\.example\.test\/orders\/private-order-id/);

  const signedUrl = "https://store.example.test/orders/private-order-id?token=signed-secret-token";
  const guestHtml = templates.getOrderConfirmationEmailHtml({ ...base, storeUrl: "", orderAccessUrl: signedUrl });
  assert.match(guestHtml, /token=signed-secret-token/);
  assert.doesNotMatch(guestHtml.replace(signedUrl, ""), /\/orders\/private-order-id/);
});
