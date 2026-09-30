import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import React from "react";
import { act } from "react-dom/test-utils";
import { moduleLoader } from "./helpers/load-module";

test("confirmed checkout reconciles the persisted cart exactly once; unpaid returns preserve it", async () => {
  const { JSDOM } = createRequire(import.meta.url)("jsdom");
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  let root: ReturnType<typeof import("react-dom/client").createRoot> | undefined;
  try {
    const router = { refresh() {} };
    const load = moduleLoader({ "next/navigation": { useRouter: () => router } });
    const { useCart } = load("lib/cart-store");
    const { CheckoutCartSync } = load("components/shop/checkout-cart-sync");
    const product = (productId: string, quantity: number) => ({ productId, quantity, name: productId, price: 10, image: "", stock: 10 });
    const purchased = [{ productId: "a", quantity: 2 }];
    useCart.setState({ items: [product("a", 2)], discount: { code: "TEST", type: "FIXED", value: 1 } });
    useCart.getState().rememberCheckout("order-1", purchased);
    // Checkout snapshot survives redirect/reload and does not clear before payment.
    await useCart.persist.rehydrate();
    assert.deepEqual(useCart.getState().pendingCheckouts["order-1"], purchased);
    assert.equal(useCart.getState().items[0].quantity, 2);

    const { createRoot } = await import("react-dom/client");
    root = createRoot(dom.window.document.getElementById("root")!);
    const render = async (status: string, orderId = "order-1") => act(async () => {
      root!.render(React.createElement(CheckoutCartSync, { orderId, status, items: purchased }));
    });
    for (const status of ["PENDING", "CANCELLED", "REFUNDED"]) {
      await render(status);
      assert.equal(useCart.getState().items[0].quantity, 2);
    }
    await render("CONFIRMED");
    assert.deepEqual(useCart.getState().items, []);
    assert.equal(useCart.getState().discount, null);
    assert.deepEqual(JSON.parse(dom.window.localStorage.getItem("cart-storage")!).state.items, []);

    // Refreshing/revisiting the same receipt must not delete new purchases.
    useCart.setState({ items: [product("a", 3), product("b", 1)] });
    await render("PROCESSING");
    assert.equal(useCart.getState().items[0].quantity, 3);
    await render("CONFIRMED", "unrelated-admin-order");
    assert.equal(useCart.getState().items.length, 2);

    // Only the submitted/confirmed quantities are removed, not the entire cart.
    useCart.getState().rememberCheckout("order-2", purchased);
    await render("CONFIRMED", "order-2");
    assert.deepEqual(useCart.getState().items.map(({ productId, quantity }: any) => ({ productId, quantity })), [
      { productId: "a", quantity: 1 }, { productId: "b", quantity: 1 },
    ]);
    await useCart.persist.rehydrate();
    useCart.getState().completeCheckout("order-2", purchased);
    assert.equal(useCart.getState().items[0].quantity, 1);
    // Older cart storage (without checkout snapshots) still hydrates safely.
    dom.window.localStorage.setItem("cart-storage", JSON.stringify({ state: { items: [product("a", 1)], discount: null }, version: 0 }));
    await useCart.persist.rehydrate();
    assert.doesNotThrow(() => useCart.getState().completeCheckout("old-order", purchased));
  } finally {
    if (root) await act(async () => root!.unmount());
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
