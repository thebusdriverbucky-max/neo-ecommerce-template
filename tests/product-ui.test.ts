import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import React from "react";
import { act, Simulate } from "react-dom/test-utils";
import { moduleLoader } from "./helpers/load-module";

test("actual admin UI preserves errors/drafts, handles widget callbacks and saves only once", async () => {
  // jsdom is already installed by isomorphic-dompurify; no browser/provider is used.
  const { JSDOM } = createRequire(import.meta.url)("jsdom");
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
  const install = (key: string, value: unknown) => {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  install("window", dom.window);
  install("document", dom.window.document);
  install("navigator", dom.window.navigator);
  install("localStorage", dom.window.localStorage);
  install("IS_REACT_ACT_ENVIRONMENT", true);
  const originalCloud = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const originalPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
  let root: ReturnType<typeof import("react-dom/client").createRoot> | undefined;
  try {
    let widgetLoading = true;
    let opened = 0;
    const widgetProps: any[] = [];
    const retainedCallbacks: any[] = [];
    const requests: any[] = [];
    let saveResponse: () => Promise<Response> = async () => Response.json({ error: "Slug is already in use", fieldErrors: { slug: "Choose a unique slug" } }, { status: 409 });
    install("fetch", async (url: string, options?: RequestInit) => {
      if (url === "/api/products?all=true") return Response.json([]);
      assert.equal(url, "/api/products");
      assert.equal(options?.method, "POST");
      requests.push(JSON.parse(options!.body as string));
      return saveResponse();
    });
    function Widget(props: any) {
      const index = React.useRef(-1);
      if (index.current === -1) {
        index.current = widgetProps.length;
        retainedCallbacks[index.current] = props;
      }
      widgetProps[index.current] = props;
      return props.children({ isLoading: widgetLoading, open: () => { opened++; } });
    }
    const load = moduleLoader({
      "next-cloudinary": { CldUploadWidget: Widget },
      "next-auth/react": { useSession: () => ({ data: { user: { role: "ADMIN" } }, status: "authenticated" }) },
      "next/navigation": { redirect() { throw new Error("Unexpected redirect"); } },
      "@/app/actions/settings": { getSettings: async () => ({ success: true, data: { enabledCategories: ["Clothing"] } }) },
    });
    const { createRoot } = await import("react-dom/client");
    const container = dom.window.document.getElementById("root") as HTMLElement;
    root = createRoot(container);
    const text = () => container.textContent || "";
    const button = (label: string) => {
      const found = Array.from(container.querySelectorAll("button")).find(node => node.textContent === label);
      assert.ok(found, `Missing button: ${label}`);
      return found;
    };
    const click = async (label: string) => act(async () => { Simulate.click(button(label)); });
    const change = async (selector: string, value: string) => act(async () => {
      const input = container.querySelector(selector) as HTMLInputElement;
      assert.ok(input, selector);
      Simulate.change(input, { target: { value } } as any);
    });

    delete process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    delete process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
    const { ProductImageUpload } = load("components/admin/product-image-upload.tsx");
    await act(async () => { root!.render(React.createElement(ProductImageUpload, { onUpload() {} })); });
    assert.match(text(), /Upload is not configured/);
    assert.equal(widgetProps.length, 0);

    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = "isolated-test";
    process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET = "isolated-test-preset";
    const Page = load("app/(dashboard)/admin/products/page.tsx").default;
    await act(async () => { root!.render(React.createElement(Page)); });
    await click("Add Product");
    assert.equal(button("Loading uploader...").disabled, true);
    await click("Create");
    assert.match(text(), /Please correct the highlighted fields/);
    assert.match(text(), /Description must be at least 10/);
    assert.ok(button("Create"));
    assert.equal(requests.length, 0);

    widgetLoading = false;
    await change('[name="name"]', "Current product name");
    await change('[name="slug"]', "test-product");
    await change('[name="description"]', "A useful product description");
    await change('[name="price"]', "12.50");
    await change('[name="stock"]', "0");
    await change('[name="category"]', "Clothing");
    await click("Upload");
    assert.equal(opened, 1);
    assert.equal(widgetProps[0].options.resourceType, "image");
    assert.equal(widgetProps[0].options.multiple, false);
    await act(async () => { retainedCallbacks[0].onError({ message: "Provider error" }); });
    assert.match(text(), /Upload failed/);
    await act(async () => { retainedCallbacks[0].onSuccess({ event: "success", info: "unexpected" }); });
    assert.match(text(), /no valid image URL/);

    const originalSetItem = dom.window.Storage.prototype.setItem;
    dom.window.Storage.prototype.setItem = () => { throw new Error("Storage blocked"); };
    const image = "https://res.cloudinary.com/isolated/image/upload/main.png";
    await act(async () => { retainedCallbacks[0].onSuccess({ event: "success", info: { secure_url: image, resource_type: "image" } }); });
    assert.equal((container.querySelector('[placeholder="Main Image URL"]') as HTMLInputElement).value, image);
    assert.equal((container.querySelector('[name="name"]') as HTMLInputElement).value, "Current product name");
    assert.match(text(), /Image added to the form/);
    dom.window.Storage.prototype.setItem = originalSetItem;
    await act(async () => {
      for (let i = 0; i < 5; i++) retainedCallbacks[1].onSuccess({ event: "success", info: { secure_url: `${image}?i=${i}` } });
    });
    assert.equal(container.querySelectorAll('[placeholder^="Image "]').length, 4);

    await click("Create");
    assert.match(text(), /Slug is already in use/);
    assert.match(text(), /Choose a unique slug/);
    assert.ok(button("Create"));
    assert.equal(requests[0].price, 12.5);
    assert.equal(requests[0].stock, 0);
    assert.equal(requests[0].image, image);
    assert.equal(requests[0].images.length, 4);

    saveResponse = async () => { throw new Error("Offline"); };
    await click("Create");
    assert.match(text(), /Could not reach the server/);
    assert.ok(button("Create"));

    let finish!: (value: Response) => void;
    saveResponse = () => new Promise(resolve => { finish = resolve; });
    const before = requests.length;
    await act(async () => {
      const create = button("Create");
      Simulate.click(create);
      Simulate.click(create);
    });
    assert.equal(requests.length, before + 1);
    assert.equal(button("Loading...").disabled, true);
    assert.equal(button("Cancel").disabled, true);
    await act(async () => { finish(Response.json({ id: "product-test" }, { status: 201 })); });
    assert.match(text(), /Product created/);
    assert.equal(container.querySelector('[name="name"]'), null);
    assert.equal(dom.window.localStorage.getItem("admin_product_form_draft"), null);
  } finally {
    if (root) await act(async () => { root!.unmount(); });
    dom.window.close();
    for (const [key, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    if (originalCloud === undefined) delete process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    else process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = originalCloud;
    if (originalPreset === undefined) delete process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
    else process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET = originalPreset;
  }
});
