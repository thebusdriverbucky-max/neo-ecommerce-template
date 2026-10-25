import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import React from "react";
import { act, Simulate } from "react-dom/test-utils";
import { COUNTRIES } from "../lib/constants";
import { toMinorUnits } from "../lib/order-money";
import { moduleLoader } from "./helpers/load-module";

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
  paymentIban: " DE89 3704 0044 0532 0130 00 ",
  paymentBankName: "Test Bank",
  paymentAccountName: "Shop Ltd",
  paymentDetails: "Use the order number as reference",
};

function settingsActions(options: { role?: string; existing?: any; fail?: boolean } = {}) {
  const log: Array<[string, any]> = [];
  const tx = {
    storeSettings: {
      update: async (args: any) => log.push(["update", args]),
      upsert: async (args: any) => log.push(["upsert", args]),
      create: async (args: any) => log.push(["create", args]),
    },
    product: { updateMany: async (args: any) => { log.push(["products", args]); if (options.fail) throw new Error("db down"); } },
  };
  const load = moduleLoader({
    "@/lib/auth": { auth: async () => ({ user: { role: options.role ?? "ADMIN" } }) },
    "next/cache": { revalidatePath: (path: string) => log.push(["revalidate", path]) },
    "@/lib/db": {
      db: {
        storeSettings: {
          findFirst: async (args: any) => { log.push(["findFirst", args]); return options.existing ?? null; },
          create: async (args: any) => log.push(["readCreate", args]),
        },
        $transaction: async (fn: any) => fn(tx),
      },
    },
  });
  return { actions: load("app/actions/settings.ts"), log };
}

const names = (log: Array<[string, any]>) => log.map(([name]) => name);
const written = (log: Array<[string, any]>, name: string) => log.find(([entry]) => entry === name)![1];

test("updateSettings requires an administrator and writes nothing otherwise", async () => {
  const { actions, log } = settingsActions({ role: "CUSTOMER" });
  assert.deepEqual(await actions.updateSettings(valid), { success: false, error: "Unauthorized" });
  assert.deepEqual(names(log), []);
});

test("valid settings are normalized and saved to the oldest settings row", async () => {
  const { actions, log } = settingsActions({ existing: { id: "row-1", currency: "USD" } });
  assert.deepEqual(await actions.updateSettings(valid), { success: true });
  assert.deepEqual(written(log, "findFirst").orderBy, [{ createdAt: "asc" }, { id: "asc" }]);
  const update = written(log, "update");
  assert.equal(update.where.id, "row-1");
  const data = update.data;
  assert.equal(data.currency, "EUR");
  assert.equal(data.taxRate, 8.875);
  assert.equal(data.freeShippingThreshold, 75);
  assert.deepEqual(data.enabledCountries, ["Germany", "France"]);
  assert.deepEqual(data.enabledCategories, ["Home", "Sports"]);
  assert.equal(data.facebookUrl, null);
  assert.equal(data.heroSubtitle, null);
  assert.equal(data.siteLang, "de");
  // Bank-transfer fields keep working: trimmed and stored.
  assert.equal(data.paymentIban, "DE89 3704 0044 0532 0130 00");
  assert.equal(data.paymentBankName, "Test Bank");
  assert.equal(data.paymentAccountName, "Shop Ltd");
  assert.equal(data.paymentDetails, "Use the order number as reference");
  assert.ok(names(log).includes("revalidate"));
});

test("changing the store currency relabels every product in the same transaction", async () => {
  const { actions, log } = settingsActions({ existing: { id: "row-1", currency: "USD" } });
  assert.equal((await actions.updateSettings(valid)).success, true);
  assert.deepEqual(written(log, "products"), { data: { currency: "EUR" } });
  // Settings and products are written by the same transaction client, settings first.
  assert.deepEqual(names(log).filter(name => ["update", "products"].includes(name)), ["update", "products"]);
});

test("a failing product update fails the save instead of leaving mixed currencies", async () => {
  const { actions } = settingsActions({ existing: { id: "row-1", currency: "USD" }, fail: true });
  const result = await actions.updateSettings(valid);
  assert.equal(result.success, false);
  assert.equal(result.error, "Failed to update settings");
});

test("currency is not rewritten on products when it did not change", async () => {
  const { actions, log } = settingsActions({ existing: { id: "row-1", currency: "EUR" } });
  assert.equal((await actions.updateSettings(valid)).success, true);
  assert.ok(!names(log).includes("products"));
});

test("a store already on an unlisted currency can keep saving, but cannot switch to one", async () => {
  const legacy = settingsActions({ existing: { id: "row-1", currency: "PLN" } });
  assert.equal((await legacy.actions.updateSettings({ ...valid, currency: "pln" })).success, true);
  assert.ok(!names(legacy.log).includes("products"));

  const switching = settingsActions({ existing: { id: "row-1", currency: "PLN" } });
  const result = await switching.actions.updateSettings({ ...valid, currency: "SEK" });
  assert.equal(result.success, false);
  assert.ok(result.fieldErrors.currency);
  assert.ok(!names(switching.log).includes("update"));
});

test("each invalid field is rejected with a field error and nothing is written", async () => {
  const cases: Array<[string, unknown]> = [
    ["currency", "XXX"],
    ["currency", "US"],
    ["currency", ""],
    ["taxRate", -1],
    ["taxRate", 100.5],
    ["taxRate", Number.NaN],
    ["taxRate", "5"],
    ["shippingCost", -0.01],
    ["shippingCost", 100_000.01],
    ["shippingCost", 1_000_000_000],
    ["shippingCost", 1.999],
    ["shippingCost", Number.POSITIVE_INFINITY],
    ["freeShippingThreshold", -1],
    ["freeShippingThreshold", 1_000_000.01],
    ["freeShippingThreshold", 1e21],
    ["freeShippingThreshold", "50"],
    ["freeShippingThreshold", ""],
    ["storeEmail", "not-an-email"],
    ["storeEmail", "a@b"],
    ["tiktokUrl", "javascript:alert(1)"],
    ["facebookUrl", "ftp://example.com"],
    ["instagramUrl", "not a url"],
    ["faviconUrl", "data:image/png;base64,AAAA"],
    ["ogImageUrl", "//example.com/a.png"],
    ["storeName", "x".repeat(101)],
    ["heroTitle", "x".repeat(151)],
    ["heroSubtitle", "x".repeat(301)],
    ["heroButtonText", "x".repeat(51)],
    ["ctaTitle", "x".repeat(151)],
    ["ctaSubtitle", "x".repeat(301)],
    ["ctaButtonText", "x".repeat(51)],
    ["footerCopyright", "x".repeat(201)],
    ["paymentIban", "x".repeat(65)],
    ["paymentBankName", "x".repeat(101)],
    ["paymentAccountName", "x".repeat(101)],
    ["paymentDetails", "x".repeat(2001)],
    ["enabledCountries", ["Atlantis"]],
    ["enabledCountries", "Germany"],
    ["enabledCategories", ["Home", "  "]],
    ["enabledCategories", ["x".repeat(51)]],
    ["enabledCategories", Array.from({ length: 51 }, (_, i) => `Category ${i}`)],
    ["enabledCategories", "Home"],
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

test("money bounds match the order engine so no saved value can break checkout", async () => {
  const ok = { ...valid, currency: "USD", shippingCost: 100_000, freeShippingThreshold: 1_000_000 };
  const { actions, log } = settingsActions({ existing: { id: "row-1", currency: "USD" } });
  assert.equal((await actions.updateSettings(ok)).success, true);
  const data = written(log, "update").data;
  // The server rule compares toMinorUnits(String(threshold)), which throws above 1,000,000.00.
  assert.doesNotThrow(() => toMinorUnits(String(data.freeShippingThreshold)));
  assert.doesNotThrow(() => toMinorUnits(String(data.shippingCost)));
});

test("free shipping: null disables it, 0 ships everything free, omitted keeps the stored value", async () => {
  const saved = async (patch: Record<string, unknown>) => {
    const { actions, log } = settingsActions({ existing: { id: "row-1", currency: "EUR" } });
    const result = await actions.updateSettings({ ...valid, ...patch });
    assert.equal(result.success, true);
    return written(log, "update").data;
  };
  assert.equal((await saved({ freeShippingThreshold: null })).freeShippingThreshold, null);
  assert.equal((await saved({ freeShippingThreshold: 0 })).freeShippingThreshold, 0);
  const { freeShippingThreshold: _omit, ...withoutThreshold } = valid;
  const { actions, log } = settingsActions({ existing: { id: "row-1", currency: "EUR" } });
  assert.equal((await actions.updateSettings(withoutThreshold)).success, true);
  assert.equal(written(log, "update").data.freeShippingThreshold, undefined);
});

test("every country name from the shared list is accepted", async () => {
  const { actions } = settingsActions({ existing: { id: "row-1", currency: "EUR" } });
  const result = await actions.updateSettings({ ...valid, enabledCountries: COUNTRIES.map(country => country.name) });
  assert.equal(result.success, true);
});

test("without a settings row the default row is upserted", async () => {
  const { actions, log } = settingsActions();
  assert.equal((await actions.updateSettings(valid)).success, true);
  const upsert = written(log, "upsert");
  assert.deepEqual(upsert.where, { id: "default" });
  assert.equal(upsert.create.id, "default");
  assert.equal(upsert.create.currency, "EUR");
  assert.equal(upsert.update.currency, "EUR");
  assert.ok(!names(log).includes("update"));
  assert.ok(!names(log).includes("create"));
});

test("getSettings reads the oldest row, never creates one and defaults free shipping to 500", async () => {
  const empty = settingsActions();
  const result = await empty.actions.getSettings();
  assert.equal(result.success, true);
  assert.equal(result.data.currency, "USD");
  assert.equal(result.data.freeShippingThreshold, 500);
  assert.deepEqual(names(empty.log), ["findFirst"]);
  assert.deepEqual(written(empty.log, "findFirst").orderBy, [{ createdAt: "asc" }, { id: "asc" }]);

  const existing = settingsActions({ existing: { id: "row-1", currency: "GBP", freeShippingThreshold: null } });
  const loaded = await existing.actions.getSettings();
  assert.equal(loaded.data.currency, "GBP");
  assert.equal(loaded.data.freeShippingThreshold, null);
});

test("layout metadata reads ordered settings and never falls back to vendor demo assets", async () => {
  const keys = ["NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_STORE_URL", "NEXT_PUBLIC_SITE_URL"];
  const saved = keys.map(key => process.env[key]);
  const calls: any[] = [];
  let row: any = null;
  const load = moduleLoader({
    "@/lib/db": { db: { storeSettings: { findFirst: async (args: any) => { calls.push(args); return row; } } } },
    "next/font/google": { Inter: () => ({ className: "inter" }) },
    "./globals.css": {},
    "next-auth/react": {}, "next-themes": {}, sonner: {}, "@vercel/analytics/react": {},
    "@/components/layout/navbar": {}, "@/components/layout/footer": {}, "@/components/layout/CookieBanner": {},
    "@/components/providers/settings-provider": {},
  });
  try {
    for (const key of keys) delete process.env[key];
    const { generateMetadata } = load("app/layout.tsx");
    const bare = await generateMetadata();
    assert.deepEqual(calls[0].orderBy, [{ createdAt: "asc" }, { id: "asc" }]);
    assert.equal(bare.title.default, "Store");
    assert.equal(bare.icons, undefined);
    assert.equal(bare.openGraph.url, undefined);
    assert.equal(bare.openGraph.images, undefined);
    assert.equal(bare.twitter.images, undefined);
    assert.doesNotMatch(JSON.stringify(bare), /vercel\.app|imgur/);

    process.env.NEXT_PUBLIC_APP_URL = "https://shop.example.test/";
    row = { storeName: "Acme", faviconUrl: "https://cdn.example.test/f.png", ogImageUrl: null, siteLang: "en" };
    const configured = await generateMetadata();
    assert.equal(configured.title.default, "Acme");
    assert.equal(configured.openGraph.url, "https://shop.example.test");
    assert.deepEqual(configured.icons, { icon: "https://cdn.example.test/f.png" });
    assert.deepEqual(configured.openGraph.images, [{ url: "https://cdn.example.test/f.png" }]);
  } finally {
    keys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; });
  }
});

async function withDom(run: (dom: any) => Promise<void>) {
  const { JSDOM } = createRequire(import.meta.url)("jsdom");
  const dom = new JSDOM('<div id="root"></div>', { url: "https://store.example.test/checkout" });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  try {
    await run(dom);
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
}

test("CountrySelect offers only enabled countries and resolves only exact enabled names", async () => {
  await withDom(async (dom) => {
    const CountrySelect = moduleLoader({})("components/ui/CountrySelect").default;
    const { createRoot } = await import("react-dom/client");
    const container = dom.window.document.getElementById("root")!;
    const root = createRoot(container);
    const emitted: string[] = [];
    const render = (value: string, enabledCountries: string[]) => act(async () => {
      root.render(React.createElement(CountrySelect, { label: "Country", value, onChange: (v: string) => emitted.push(v), enabledCountries }));
    });
    try {
      // A restored country the store no longer ships to is cleared.
      await render("FR", ["Germany"]);
      assert.deepEqual(emitted, [""]);
      emitted.length = 0;

      await render("DE", ["Germany"]);
      assert.deepEqual(emitted, []);
      const input = container.querySelector("input")! as HTMLInputElement;
      assert.equal(input.value, "Germany");

      // Half-typed text clears the value; the exact name resolves to the code.
      await act(async () => { Simulate.change(input, { target: { value: "Germ" } } as any); });
      assert.deepEqual(emitted, [""]);
      await render("", ["Germany"]);
      emitted.length = 0;
      await act(async () => { Simulate.change(input, { target: { value: "Germany" } } as any); });
      assert.deepEqual(emitted, ["DE"]);
      await render("DE", ["Germany"]);
      emitted.length = 0;
      // A real country that is not enabled never resolves.
      await act(async () => { Simulate.change(input, { target: { value: "France" } } as any); });
      assert.deepEqual(emitted, [""]);

      await act(async () => { Simulate.focus(input); Simulate.change(input, { target: { value: "" } } as any); });
      assert.deepEqual(Array.from(container.querySelectorAll("li")).map((li: any) => li.textContent), ["Germany"]);
    } finally {
      await act(async () => root.unmount());
    }
  });
});

test("checkout form clears a restored draft country that was disabled and blocks disabled countries", async () => {
  const draft = {
    firstName: "Ada", lastName: "Lovelace", email: "ada@example.test", phone: "+4912345",
    street: "Main 1", city: "Berlin", postalCode: "10115", state: "",
  };
  const run = async (country: string, enabledCountries: string[]) => {
    const submitted: any[] = [];
    await withDom(async (dom) => {
      dom.window.localStorage.setItem("checkout-form-data", JSON.stringify({ ...draft, country }));
      const load = moduleLoader({
        "@/components/providers/settings-provider": { useSettings: () => ({ settings: { enabledCountries }, currency: "USD" }) },
      });
      const { CheckoutForm } = load("components/shop/checkout-form.tsx");
      const { createRoot } = await import("react-dom/client");
      const container = dom.window.document.getElementById("root")!;
      const root = createRoot(container);
      try {
        await act(async () => root.render(React.createElement(CheckoutForm, { loading: false, onSubmit: (data: any) => submitted.push(data) })));
        const input = container.querySelector("#country-select") as HTMLInputElement;
        const shown = input.value;
        await act(async () => { Simulate.submit(container.querySelector("form")!); });
        const saved = dom.window.localStorage.getItem("checkout-form-data");
        submitted.push({ shown, text: container.textContent, savedCleared: saved === null });
      } finally {
        await act(async () => root.unmount());
      }
    });
    return submitted;
  };

  // Enabled draft country: shown by name, submitted as an ISO code.
  const [ok, okMeta] = await run("DE", ["Germany"]);
  assert.equal(ok.shippingAddress.country, "DE");
  assert.equal(okMeta.shown, "Germany");

  // Country disabled since the draft was saved: cleared and cannot be submitted.
  const [blocked] = await run("FR", ["Germany"]);
  assert.equal(blocked.shown, "");
  assert.match(blocked.text, /Country is required|We do not ship to this country/);
  assert.equal(blocked.savedCleared, false);

  // No restriction configured: every country stays valid.
  const [open] = await run("FR", []);
  assert.equal(open.shippingAddress.country, "FR");
});
