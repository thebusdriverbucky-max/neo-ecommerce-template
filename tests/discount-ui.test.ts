import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import React from "react";
import { act, Simulate } from "react-dom/test-utils";
import { moduleLoader } from "./helpers/load-module";

test("discount admin preserves invalid input, shows server errors, saves once and keeps legacy expiry", async () => {
  const { JSDOM } = createRequire(import.meta.url)("jsdom");
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  let root: ReturnType<typeof import("react-dom/client").createRoot> | undefined;
  const legacyExpiry = "2027-01-01T00:00:00.000Z";
  const legacy = { id: "legacy", code: "LEGACY", type: "FIXED", value: 10, isActive: true, expiresAt: legacyExpiry };
  const discounts = [legacy];
  const writes: Array<{ method: string; data: any }> = [];
  let saveResponse = async () => Response.json({ error: "A discount with this code already exists.", fieldErrors: { code: "Choose a different code" } }, { status: 409 });
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (_url: unknown, init?: RequestInit) => {
      if (!init?.method) return Response.json(discounts);
      if (init.method === "DELETE") return Response.json({ error: "Delete failed" }, { status: 500 });
      const data = JSON.parse(String(init.body));
      writes.push({ method: init.method, data });
      return saveResponse();
    },
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  try {
    const session = { user: { role: "ADMIN" } };
    const load = moduleLoader({
      "next-auth/react": { useSession: () => ({ data: session, status: "authenticated" }) },
      "next/navigation": { useRouter: () => ({ push() {} }) },
      "@/components/providers/settings-provider": { useSettings: () => ({ currency: "EUR", settings: { currency: "EUR" } }) },
    });
    const Page = load("app/(dashboard)/admin/discounts/page.tsx").default;
    const { createRoot } = await import("react-dom/client");
    const container = dom.window.document.getElementById("root")! as HTMLElement;
    root = createRoot(container);
    await act(async () => { root!.render(React.createElement(Page)); });
    const text = () => container.textContent || "";
    const button = (label: string) => Array.from(container.querySelectorAll("button")).find(el => el.textContent?.trim() === label)! as HTMLButtonElement;
    const click = async (label: string) => act(async () => { Simulate.click(button(label)); });
    const change = async (id: string, value: string) => act(async () => { Simulate.change(container.querySelector(`#${id}`)!, { target: { value } } as any); });

    assert.match(text(), /€/);
    await click("Add Discount");
    await change("discount-code", " save10 ");
    await change("discount-value", "150");
    await click("Create");
    assert.match(text(), /Percentage cannot exceed 100/);
    assert.equal(writes.length, 0);
    assert.ok(button("Create"));
    await change("discount-value", "10");
    await change("discount-expiry", "2027-03-01");
    await click("Create");
    assert.match(text(), /already exists/);
    assert.match(text(), /Choose a different code/);
    assert.ok(button("Create"));
    assert.equal(writes[0].data.code, "SAVE10");
    assert.equal(writes[0].data.expiresAt, "2027-03-01T23:59:59.999Z");
    saveResponse = async () => { throw new Error("Offline"); };
    await click("Create");
    assert.match(text(), /Check your connection/);
    assert.equal((container.querySelector("#discount-value") as HTMLInputElement).value, "10");

    let finish!: (response: Response) => void;
    saveResponse = () => new Promise(resolve => { finish = resolve; });
    const before = writes.length;
    await act(async () => {
      Simulate.click(button("Create"));
      Simulate.click(button("Create"));
    });
    assert.equal(writes.length, before + 1);
    assert.equal(button("Loading...").disabled, true);
    assert.equal(button("Cancel").disabled, true);
    await act(async () => { finish(Response.json({ id: "new" }, { status: 201 })); });
    assert.equal(container.querySelector("#discount-code"), null);

    saveResponse = async () => Response.json(legacy);
    await click("Edit");
    await change("discount-value", "20");
    await click("Update");
    assert.equal(writes.at(-1)!.method, "PUT");
    assert.equal(writes.at(-1)!.data.expiresAt, legacyExpiry);

    await click("Delete");
    // There is also a row-level Delete button; target the last (dialog) one.
    await act(async () => {
      const buttons = Array.from(container.querySelectorAll("button")).filter(el => el.textContent?.trim() === "Delete");
      Simulate.click(buttons.at(-1)!);
    });
    assert.match(text(), /Delete failed/);
    assert.match(text(), /Delete Discount/);
  } finally {
    if (root) await act(async () => { root!.unmount(); });
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
