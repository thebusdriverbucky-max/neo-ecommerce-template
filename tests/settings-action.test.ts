import { createRequire } from "node:module";
import assert from "node:assert/strict";
import test from "node:test";
import { COUNTRIES } from "../lib/constants";
import { moduleLoader } from "./helpers/load-module";

const require = createRequire(import.meta.url);

const valid = {
  storeName: "My Shop",
  storeEmail: "support@example.com",
  currency: "eur",
  taxRate: 8.875,
  shippingCost: 4.99,
  freeShippingThreshold: 75,
  enabledCountries: ["Germany", "France", "Germany"],
  enabledCategories: ["Home", " Sports ", "Home"],
  tiktokUrl: "https://tiktok.com/@shop",
  facebookUrl: "",
  instagramUrl: "https://instagram.com/shop",
  heroTitle: "Hello",
  heroSubtitle: "",
  heroButtonText: "Shop",
  ctaTitle: "CTA",
  ctaSubtitle: "Sub",
  ctaButtonText: "Go",
  footerCopyright: "",
  faviconUrl: "https://example.com/favicon.png",
  ogImageUrl: "",
  siteLang: "de",
};

function settingsActions(options: { role?: string; existing?: any } = {}) {
  const log: Array<[string, any]> = [];
  const tx = {
    storeSettings: {
      update: async (args: any) => log.push(["update", args]),
      upsert: async (args: any) => log.push(["upsert", args]),
      create: async (args: any) => log.push(["create", args]),
    },
    product: { updateMany: async (args: any) => log.push(["products", args]) },
  };
  const load = moduleLoader({
    "@/lib/auth": { auth: async () => ({ user: { role: options.role ?? "ADMIN" } }) },
    "next/cache": { revalidatePath: (path: string) => log.push(["revalidate", path]) },
    "@prisma/client": require("@prisma/client"),
    "@/lib/db": {
      db: {
        storeSettings: {
          findFirst: async (args: any) => {
            log.push(["findFirst", args]);
            return options.existing ?? null;
          },
          create: async (args: any) => log.push(["readCreate", args]),
        },
        $transaction: async (fn: any) => fn(tx),
      },
    },
  });
  return { actions: load("app/actions/settings.ts"), log };
}

const names = (log: Array<[string, any]>) => log.map(([name]) => name);

test("updateSettings requires an administrator", async () => {
  const { actions, log } = settingsActions({ role: "CUSTOMER" });
  const result = await actions.updateSettings(valid);
  assert.deepEqual(result, { success: false, error: "Unauthorized" });
  assert.deepEqual(names(log), []);
});

test("valid settings are normalized and saved to the oldest row", async () => {
  const { actions, log } = settingsActions({ existing: { id: "row-1", currency: "USD" } });
  assert.deepEqual(await actions.updateSettings(valid), { success: true });
  const find = log.find(([name]) => name === "findFirst")![1];
  assert.deepEqual(find.orderBy, [{ createdAt: "asc" }, { id: "asc" }]);
  const update = log.find(([name]) => name === "update")![1];
  assert.equal(update.where.id, "row-1");
  const data = update.data;
  assert.equal(data.currency, "EUR");
  assert.equal(data.taxRate, 8.875);
  assert.equal(data.freeShippingThreshold, 75);
  assert.deepEqual(data.enabledCountries, ["Germany", "France"]);
  assert.deepEqual(data.enabledCategories, ["Home", "Sports"]);
  // Empty strings clear optional text and URLs.
  assert.equal(data.facebookUrl, null);
  assert.equal(data.heroSubtitle, null);
  assert.equal(data.ogImageUrl, null);
  assert.equal(data.siteLang, "de");
  // Currency changed from USD: products follow, with no price conversion.
  assert.deepEqual(log.find(([name]) => name === "products")![1], { data: { currency: "EUR" } });
  assert.ok(names(log).includes("revalidate"));
});

test("currency is not rewritten on products when it did not change", async () => {
  const { actions, log } = settingsActions({ existing: { id: "row-1", currency: "EUR" } });
  assert.equal((await actions.updateSettings(valid)).success, true);
  assert.ok(!names(log).includes("products"));
});

test("each invalid field is rejected with a field error and nothing is written", async () => {
  const cases: Array<[string, unknown]> = [
    ["currency", "XXX"],
    ["currency", "US"],
    ["taxRate", -1],
    ["taxRate", 100.5],
    ["taxRate", Number.NaN],
    ["taxRate", "5"],
    ["shippingCost", -0.01],
    ["shippingCost", 1_000_001],
    ["shippingCost", 1.999],
    ["freeShippingThreshold", -1],
    ["freeShippingThreshold", 100_000_001],
    ["freeShippingThreshold", "50"],
    ["storeEmail", "not-an-email"],
    ["tiktokUrl", "javascript:alert(1)"],
    ["facebookUrl", "ftp://example.com"],
    ["instagramUrl", "not a url"],
    ["faviconUrl", "data:image/png;base64,AAAA"],
    ["ogImageUrl", "//example.com/a.png"],
    ["storeName", "x".repeat(101)],
    ["heroSubtitle", "x".repeat(301)],
    ["footerCopyright", "x".repeat(201)],
    ["enabledCountries", ["Atlantis"]],
    ["enabledCountries", "Germany"],
    ["enabledCategories", ["Home", "  "]],
    ["enabledCategories", ["x".repeat(51)]],
    ["enabledCategories", Array.from({ length: 51 }, (_, i) => `Category ${i}`)],
    ["siteLang", "xx"],
  ];
  for (const [field, value] of cases) {
    const { actions, log } = settingsActions({ existing: { id: "row-1", currency: "USD" } });
    const result = await actions.updateSettings({ ...valid, [field]: value });
    assert.equal(result.success, false, `${field}=${String(value).slice(0, 20)}`);
    assert.equal(result.error, "Please correct the highlighted fields.");
    assert.ok(result.fieldErrors[field], `${field} should have a field error`);
    assert.ok(!names(log).some(name => ["update", "upsert", "products"].includes(name)), field);
  }
});

test("free shipping: null disables it, 0 ships everything free, omitted keeps the stored value", async () => {
  const saved = async (patch: Record<string, unknown>) => {
    const { actions, log } = settingsActions({ existing: { id: "row-1", currency: "EUR" } });
    const result = await actions.updateSettings({ ...valid, ...patch });
    assert.equal(result.success, true);
    return log.find(([name]) => name === "update")![1].data;
  };
  assert.equal((await saved({ freeShippingThreshold: null })).freeShippingThreshold, null);
  assert.equal((await saved({ freeShippingThreshold: 0 })).freeShippingThreshold, 0);
  const { freeShippingThreshold: _omit, ...withoutThreshold } = valid;
  const { actions, log } = settingsActions({ existing: { id: "row-1", currency: "EUR" } });
  assert.equal((await actions.updateSettings(withoutThreshold)).success, true);
  assert.equal(log.find(([name]) => name === "update")![1].data.freeShippingThreshold, undefined);
});

test("country names from the shared list are all accepted", async () => {
  const { actions } = settingsActions({ existing: { id: "row-1", currency: "EUR" } });
  const result = await actions.updateSettings({ ...valid, enabledCountries: COUNTRIES.map(country => country.name) });
  assert.equal(result.success, true);
});

test("without a settings row the default row is upserted", async () => {
  const { actions, log } = settingsActions();
  assert.equal((await actions.updateSettings(valid)).success, true);
  const upsert = log.find(([name]) => name === "upsert")![1];
  assert.deepEqual(upsert.where, { id: "default" });
  assert.equal(upsert.create.id, "default");
  assert.equal(upsert.create.currency, "EUR");
  assert.equal(upsert.update.currency, "EUR");
  assert.ok(!names(log).includes("update"));
  assert.ok(!names(log).includes("create"));
});

test("getSettings never creates a row and returns defaults when none exists", async () => {
  const empty = settingsActions();
  const result = await empty.actions.getSettings();
  assert.equal(result.success, true);
  assert.equal(result.data.currency, "USD");
  assert.equal(result.data.freeShippingThreshold, 500);
  assert.deepEqual(result.data.enabledCategories, []);
  assert.deepEqual(names(empty.log), ["findFirst"]);

  const existing = settingsActions({ existing: { id: "row-1", currency: "GBP", freeShippingThreshold: null } });
  const loaded = await existing.actions.getSettings();
  assert.equal(loaded.data.currency, "GBP");
  assert.equal(loaded.data.freeShippingThreshold, null);
  assert.deepEqual(names(existing.log), ["findFirst"]);
});
