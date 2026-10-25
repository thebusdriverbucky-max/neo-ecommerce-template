import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { moduleLoader } from "./helpers/load-module";
import { calculateStorefrontTotals, freeShippingHint } from "../lib/discounts";
import {
  availableCountries, filterCountries, resolveCountryInput, sanitizeCountryValue,
} from "../lib/country-options";
import { belowMinimumNotice, describeCheckoutFailure, orderPagePath, toMinorUnits } from "../lib/checkout-client";

const DAY = 24 * 60 * 60 * 1000;

async function withBrowser<T>(run: (dom: any) => Promise<T>): Promise<T> {
  const { JSDOM } = createRequire(import.meta.url)("jsdom");
  const dom = new JSDOM("<div></div>", { url: "http://localhost" });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  try {
    return await run(dom);
  } finally {
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

const product = (productId: string, quantity: number) => ({ productId, quantity, name: productId, price: 10, image: "", stock: 10 });

test("persisted cart from older versions migrates pendingCheckouts to the new shape", async () => {
  await withBrowser(async (dom) => {
    const { useCart } = moduleLoader({})("lib/cart-store");
    dom.window.localStorage.setItem("cart-storage", JSON.stringify({
      state: { items: [product("a", 3)], discount: null, pendingCheckouts: { "old-order": [{ productId: "a", quantity: 2 }] } },
      version: 0,
    }));
    await useCart.persist.rehydrate();
    const migrated = useCart.getState().pendingCheckouts["old-order"];
    assert.deepEqual(migrated.items, [{ productId: "a", quantity: 2 }]);
    assert.equal(typeof migrated.createdAt, "number");
    assert.equal(migrated.guestAccessToken, undefined);
    useCart.getState().completeCheckout("old-order", [{ productId: "a", quantity: 2 }]);
    assert.equal(useCart.getState().items[0].quantity, 1);
    assert.equal(useCart.getState().pendingCheckouts["old-order"], undefined);
    assert.equal(JSON.parse(dom.window.localStorage.getItem("cart-storage")!).version, 1);

    // A cart persisted before pendingCheckouts existed also hydrates.
    dom.window.localStorage.setItem("cart-storage", JSON.stringify({ state: { items: [product("a", 1)], discount: null } }));
    await useCart.persist.rehydrate();
    assert.deepEqual(useCart.getState().pendingCheckouts, {});
    assert.equal(useCart.getState().items.length, 1);
  });
});

test("completeCheckout works for legacy array snapshots and new snapshots; rememberCheckout stores the guest token", async () => {
  await withBrowser(async () => {
    const { useCart } = moduleLoader({})("lib/cart-store");
    const purchased = [{ productId: "a", quantity: 1 }];
    // Legacy shape set directly (e.g. by a tab that was open during an upgrade).
    useCart.setState({ items: [product("a", 2)], pendingCheckouts: { legacy: purchased } as any });
    useCart.getState().completeCheckout("legacy", purchased);
    assert.equal(useCart.getState().items[0].quantity, 1);
    assert.equal(useCart.getState().pendingCheckouts.legacy, undefined);

    useCart.getState().rememberCheckout("new", [{ productId: "a", quantity: 1, extra: "x" } as any], "tok");
    assert.deepEqual(useCart.getState().pendingCheckouts.new.items, [{ productId: "a", quantity: 1 }]);
    assert.equal(useCart.getState().pendingCheckouts.new.guestAccessToken, "tok");
    useCart.getState().completeCheckout("unknown", purchased);
    assert.equal(useCart.getState().items.length, 1);
    useCart.getState().completeCheckout("new", purchased);
    assert.deepEqual(useCart.getState().items, []);

    useCart.getState().rememberCheckout("x", purchased);
    useCart.getState().rememberCheckout("y", purchased);
    useCart.getState().forgetCheckouts(["x", "missing"]);
    assert.deepEqual(Object.keys(useCart.getState().pendingCheckouts), ["y"]);
  });
});

test("rememberCheckout keeps at most 5 newest entries", async () => {
  await withBrowser(async () => {
    const { useCart } = moduleLoader({})("lib/cart-store");
    const realNow = Date.now;
    let now = 1_000_000;
    Date.now = () => now;
    try {
      for (let i = 1; i <= 7; i++) { now += 1000; useCart.getState().rememberCheckout(`o${i}`, [{ productId: "a", quantity: 1 }]); }
    } finally { Date.now = realNow; }
    assert.deepEqual(Object.keys(useCart.getState().pendingCheckouts).sort(), ["o3", "o4", "o5", "o6", "o7"]);
  });
});

test("previousCheckouts payload is newest first, capped at 5 and drops expired entries", async () => {
  await withBrowser(async () => {
    const { buildPreviousCheckouts, prunePendingCheckouts } = moduleLoader({})("lib/cart-store");
    const now = 10 * DAY;
    const entry = (age: number, token?: string) => ({ items: [], createdAt: now - age, ...(token ? { guestAccessToken: token } : {}) });
    const pending = {
      middle: entry(2000), newest: entry(1000, "guest-token"), oldest: entry(3000), expired: entry(3 * DAY),
      legacy: [{ productId: "a", quantity: 1 }],
    };
    const payload = buildPreviousCheckouts(pending, now);
    assert.deepEqual(payload.map((p: any) => p.orderId).slice(0, 4), ["legacy", "newest", "middle", "oldest"]);
    assert.deepEqual(payload.find((p: any) => p.orderId === "newest"), { orderId: "newest", guestAccessToken: "guest-token" });
    assert.deepEqual(payload.find((p: any) => p.orderId === "middle"), { orderId: "middle" });
    assert.ok(!payload.some((p: any) => p.orderId === "expired"));

    const many = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`o${i}`, entry(i * 1000)]));
    assert.deepEqual(buildPreviousCheckouts(many, now).map((p: any) => p.orderId), ["o0", "o1", "o2", "o3", "o4"]);
    assert.deepEqual(buildPreviousCheckouts(undefined, now), []);
    assert.deepEqual(buildPreviousCheckouts("garbage", now), []);
    assert.deepEqual(Object.keys(prunePendingCheckouts({ bad: null, ok: entry(1) }, now)), ["ok"]);
  });
});

test("free shipping threshold: null never free, 0 always free, missing settings default 500", () => {
  const items = [{ price: 100, quantity: 1 }];
  const ship = (settings: any, basis?: "discounted" | "subtotal", discount = null as any) =>
    calculateStorefrontTotals(items, discount, settings, basis);
  const base = { currency: "USD", taxRate: 0, shippingCost: 5 };

  assert.equal(ship({ ...base, freeShippingThreshold: null }).shipping, 5);
  assert.equal(calculateStorefrontTotals([{ price: 100000, quantity: 1 }], null, { ...base, freeShippingThreshold: null }).shipping, 5);
  assert.equal(ship({ ...base, freeShippingThreshold: 0 }).shipping, 0);
  assert.equal(ship({ ...base, freeShippingThreshold: 0 }).total, 100);

  // Missing threshold / missing settings fall back to the 500 default.
  assert.equal(ship({ currency: "USD", shippingCost: 5 }).shipping, 5);
  assert.equal(calculateStorefrontTotals([{ price: 500, quantity: 1 }], null, { currency: "USD", shippingCost: 5 }).shipping, 0);
  assert.equal(calculateStorefrontTotals([{ price: 499, quantity: 1 }], null, null).shipping, 0);

  // Threshold met / not met, evaluated after the discount.
  const threshold = { ...base, freeShippingThreshold: 100 };
  assert.equal(ship(threshold).shipping, 0);
  const notMet = ship(threshold, "discounted", { type: "FIXED", value: 10 });
  assert.equal(notMet.shipping, 5);
  assert.deepEqual(freeShippingHint(threshold, notMet), { threshold: 100, remaining: 10 });
  assert.equal(freeShippingHint(threshold, ship(threshold)), null);
  assert.equal(freeShippingHint({ ...base, freeShippingThreshold: null }, ship({ ...base, freeShippingThreshold: null })), null);
  assert.equal(freeShippingHint({ ...base, freeShippingThreshold: 0 }, ship({ ...base, freeShippingThreshold: 0 })), null);

  // The "subtotal" basis keeps its historical behavior (missing threshold = 0 = free).
  assert.equal(ship(threshold, "subtotal", { type: "FIXED", value: 10 }).shipping, 0);
  assert.equal(ship({ ...base }, "subtotal").shipping, 0);
  assert.equal(ship({ ...base, freeShippingThreshold: 500 }, "subtotal").shipping, 5);
});

test("existing storefront totals are unchanged", () => {
  const totals = calculateStorefrontTotals([{ price: 19.99, quantity: 3 }], { type: "PERCENT", value: 10 },
    { currency: "USD", taxRate: 8.25, shippingCost: 4.5, freeShippingThreshold: 100 });
  assert.equal(totals.subtotal, 59.97);
  assert.equal(totals.discountAmount, 6);
  assert.equal(totals.tax, 4.45);
  assert.equal(totals.shipping, 4.5);
  assert.equal(totals.total, 62.92);
});

test("country helpers accept names or codes in settings and always yield ISO codes", () => {
  assert.ok(availableCountries([]).length > 200);
  assert.deepEqual(availableCountries(["Germany", "FR", "United States"]).map(c => c.code).sort(), ["DE", "FR", "US"]);
  assert.deepEqual(filterCountries(availableCountries(["Germany", "France"]), "ger").map(c => c.code), ["DE"]);
  assert.equal(filterCountries(availableCountries([]), "  ").length, availableCountries([]).length);

  assert.equal(resolveCountryInput("germany", ["Germany"]), "DE");
  assert.equal(resolveCountryInput(" Germany ", []), "DE");
  assert.equal(resolveCountryInput("Germ", ["Germany"]), "");
  assert.equal(resolveCountryInput("France", ["Germany"]), "");
  assert.equal(resolveCountryInput("", []), "");

  assert.equal(sanitizeCountryValue("DE", ["Germany"]), "DE");
  assert.equal(sanitizeCountryValue("Germany", []), "DE");
  assert.equal(sanitizeCountryValue("FR", ["Germany"]), "");
  assert.equal(sanitizeCountryValue("ZZ", []), "");
  assert.equal(sanitizeCountryValue(undefined, []), "");
});

test("below-minimum detection converts to minor units per currency", () => {
  assert.equal(toMinorUnits(0.5, "USD"), 50);
  assert.equal(toMinorUnits(19.99, "USD"), 1999);
  assert.equal(toMinorUnits(50, "JPY"), 50);
  assert.deepEqual(belowMinimumNotice(0.49, "USD"), { minimumMajor: 0.5, currency: "USD" });
  assert.equal(belowMinimumNotice(0.5, "USD"), null);
  assert.equal(belowMinimumNotice(0, "USD"), null);
  assert.deepEqual(belowMinimumNotice(49, "JPY"), { minimumMajor: 50, currency: "JPY" });
  assert.equal(belowMinimumNotice(50, "JPY"), null);
  assert.deepEqual(belowMinimumNotice(0.29, "GBP"), { minimumMajor: 0.3, currency: "GBP" });
  assert.equal(belowMinimumNotice(0.01, "ZZZ"), null);
});

test("server error bodies surface their message; paid previous checkouts link to the order", () => {
  assert.deepEqual(describeCheckoutFailure({ error: "Only 1 left", code: "INSUFFICIENT_STOCK" }), { message: "Only 1 left", code: "INSUFFICIENT_STOCK" });
  assert.equal(describeCheckoutFailure(null).message, "Failed to create order");
  assert.equal(describeCheckoutFailure({ error: "  " }).message, "Failed to create order");
  const paid = describeCheckoutFailure({ error: "Already paid", code: "PREVIOUS_CHECKOUT_PAID", orderId: "o1", guestAccessToken: "t k" });
  assert.deepEqual(paid.paidOrder, { orderId: "o1", guestAccessToken: "t k" });
  assert.equal(describeCheckoutFailure({ error: "x", code: "PREVIOUS_CHECKOUT_PAID", orderId: "o1" }).paidOrder?.guestAccessToken, undefined);
  assert.equal(describeCheckoutFailure({ error: "x", code: "RATE_LIMITED", orderId: "o1" }).paidOrder, undefined);
  assert.equal(orderPagePath("o1"), "/orders/o1");
  assert.equal(orderPagePath("o1", "t k"), "/orders/o1?guest_token=t%20k");
});

test("CountrySelect emits ISO codes only, clears half-typed text and disabled restored countries", async () => {
  const React = (await import("react")).default;
  const { act, Simulate } = await import("react-dom/test-utils");
  await withBrowser(async (dom) => {
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true });
    const CountrySelect = moduleLoader({})("components/ui/CountrySelect").default;
    const { createRoot } = await import("react-dom/client");
    const container = dom.window.document.getElementById("root") ?? dom.window.document.body.appendChild(dom.window.document.createElement("div"));
    const root = createRoot(container);
    const emitted: string[] = [];
    const render = (value: string, enabledCountries: string[]) => act(async () => {
      root.render(React.createElement(CountrySelect, { label: "Country", value, onChange: (v: string) => emitted.push(v), enabledCountries }));
    });
    try {
      // A restored country that is no longer enabled is cleared.
      await render("FR", ["Germany"]);
      assert.deepEqual(emitted, [""]);
      emitted.length = 0;

      // Names stored in settings are accepted for codes; nothing to clear.
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

      // Only enabled countries are offered in the list.
      await act(async () => { Simulate.focus(input); Simulate.change(input, { target: { value: "" } } as any); });
      assert.deepEqual(Array.from(container.querySelectorAll("li")).map((li: any) => li.textContent), ["Germany"]);
    } finally {
      await act(async () => root.unmount());
      Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    }
  });
});
