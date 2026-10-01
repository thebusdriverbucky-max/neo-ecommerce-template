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

