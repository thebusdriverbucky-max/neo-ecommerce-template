import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import React from "react";
import { act, Simulate } from "react-dom/test-utils";
import { moduleLoader } from "./helpers/load-module";

test("Google UI stays hidden when provider is disabled/unavailable and uses configured provider only", async () => {
  const { JSDOM } = createRequire(import.meta.url)("jsdom");
  const dom = new JSDOM('<div id="root"></div>', { url: "https://store.example.test" });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const { createRoot } = await import("react-dom/client");
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const calls: any[] = [];
  try {
    for (const providers of [null, {}, new Error("Unavailable"), { google: { id: "google" } }]) {
      const load = moduleLoader({ "next-auth/react": {
        getProviders: async () => { if (providers instanceof Error) throw providers; return providers; },
        signIn: (...args: any[]) => { calls.push(args); },
      } });
      const { SocialLogin } = load("components/auth/social-login.tsx");
      await act(async () => { root.render(React.createElement(SocialLogin, { callbackUrl: "/account" })); });
      const button = container.querySelector("button");
      assert.equal(Boolean(button), Boolean(providers && !(providers instanceof Error) && "google" in providers));
      if (button) await act(async () => { Simulate.click(button); });
    }
    assert.deepEqual(calls, [["google", { callbackUrl: "/account" }]]);
  } finally {
    await act(async () => { root.unmount(); });
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
