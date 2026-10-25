import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import React from "react";
import { act, Simulate } from "react-dom/test-utils";
import { moduleLoader } from "./helpers/load-module";

const root = path.resolve(__dirname, "..");
const imageHosts = JSON.parse(readFileSync(path.join(root, "lib/image-hosts.json"), "utf8"));
const ORDER = [{ createdAt: "desc" }, { id: "desc" }];

function productsRoute(role: string | null, calls: any[] = []) {
  const load = moduleLoader({
    "@/lib/auth": { auth: async () => (role ? { user: { id: "u1", role } } : null) },
    "next/cache": { revalidatePath() {} },
    "@/lib/reservation-cleanup": { releaseExpiredReservationsForStorefront: async () => {} },
    "@/lib/db": {
      db: {
        product: {
          findMany: async (args: any) => {
            calls.push(["findMany", args]);
            return [{ id: "p2" }, { id: "p1" }];
          },
          count: async (args: any) => {
            calls.push(["count", args]);
            return 61;
          },
        },
      },
    },
  });
  return load("app/api/products/route.ts");
}

const get = (route: any, query = "") => route.GET(new Request(`http://localhost/api/products${query}`));
const lastFind = (calls: any[]) => calls.filter(([name]) => name === "findMany").at(-1)![1];

test("products GET without page keeps the legacy array, now with stable ordering", async () => {
  const calls: any[] = [];
  const response = await get(productsRoute(null, calls));
  assert.deepEqual(await response.json(), [{ id: "p2" }, { id: "p1" }]);
  const args = calls[0][1];
  assert.equal(args.take, 50);
  assert.deepEqual(args.orderBy, ORDER);
  assert.equal(args.where.isArchived, false);
  assert.equal(calls.some(([name]) => name === "count"), false);
});

test("products GET paginates with total, default and capped page size", async () => {
  const calls: any[] = [];
  const route = productsRoute(null, calls);
  assert.deepEqual(await (await get(route, "?page=2&pageSize=10")).json(), {
    products: [{ id: "p2" }, { id: "p1" }],
    total: 61,
    page: 2,
    pageSize: 10,
  });
  let find = lastFind(calls);
  assert.equal(find.skip, 10);
  assert.equal(find.take, 10);
  assert.deepEqual(find.orderBy, ORDER);

  assert.equal((await (await get(route, "?page=1")).json()).pageSize, 24);
  assert.equal((await (await get(route, "?page=1&pageSize=1000")).json()).pageSize, 100);
  const sanitized = await (await get(route, "?page=-4&pageSize=abc")).json();
  assert.deepEqual([sanitized.page, sanitized.pageSize], [1, 24]);
  find = lastFind(calls);
  assert.equal(find.skip, 0);
});

test("products GET all=true includes archived products for admins only", async () => {
  const calls: any[] = [];
  assert.equal((await get(productsRoute("CUSTOMER", calls), "?all=true&page=1")).status, 401);
  assert.equal((await get(productsRoute(null, calls), "?all=true&page=1")).status, 401);
  assert.equal(calls.length, 0);
  await get(productsRoute("ADMIN", calls), "?all=true&page=1");
  assert.equal("isArchived" in lastFind(calls).where, false);
});

test("products GET applies only the price bounds that were sent, so expensive products stay visible", async () => {
  const calls: any[] = [];
  const route = productsRoute(null, calls);
  const where = async (query: string) => {
    calls.length = 0;
    const response = await get(route, query);
    assert.equal(response.status, 200, query);
    return lastFind(calls).where;
  };
  assert.equal((await where("")).price, undefined);
  assert.equal((await where("?minPrice=&maxPrice=")).price, undefined);
  assert.deepEqual((await where("?minPrice=5")).price, { gte: 5 });
  assert.deepEqual((await where("?maxPrice=5000000")).price, { lte: 5000000 });
  assert.deepEqual((await where("?minPrice=0&maxPrice=99999999.99")).price, { gte: 0, lte: 99999999.99 });

  calls.length = 0;
  for (const query of ["?minPrice=abc", "?maxPrice=NaN", "?maxPrice=Infinity", "?minPrice=-1", "?minPrice=10&maxPrice=5"]) {
    const response = await get(route, query);
    assert.equal(response.status, 400, query);
    assert.deepEqual(await response.json(), { error: "Invalid price range" });
  }
  assert.equal(calls.length, 0);
});

test("products GET search matches name, slug and description and trims the term", async () => {
  const calls: any[] = [];
  await get(productsRoute(null, calls), "?page=1&search=%20Blue%20&category=Home");
  const where = lastFind(calls).where;
  assert.equal(where.category, "Home");
  assert.deepEqual(where.OR, [
    { name: { contains: "Blue", mode: "insensitive" } },
    { slug: { contains: "Blue", mode: "insensitive" } },
    { description: { contains: "Blue", mode: "insensitive" } },
  ]);
  calls.length = 0;
  await get(productsRoute(null, calls), "?category=all&search=");
  assert.equal("category" in lastFind(calls).where, false);
  assert.equal("OR" in lastFind(calls).where, false);
});

function productIdRoute(options: { orderItems?: number; deleteError?: unknown; updateError?: unknown; rearm?: () => Promise<void> } = {}) {
  const calls: string[] = [];
  const paths: string[] = [];
  const db = {
    orderItem: { count: async () => options.orderItems ?? 0 },
    product: {
      findUnique: async () => ({ slug: "blue-mug" }),
      delete: async () => {
        calls.push("delete");
        if (options.deleteError) throw options.deleteError;
        return { id: "p1", slug: "blue-mug" };
      },
      update: async ({ data }: any) => {
        calls.push(data.isArchived === true && Object.keys(data).length === 1 ? "archive" : "update");
        if (options.updateError) throw options.updateError;
        return { id: "p1", slug: data.slug ?? "blue-mug" };
      },
    },
  };
  const rearmCalls: unknown[][] = [];
  const load = moduleLoader({
    "@/lib/auth": { auth: async () => ({ user: { role: "ADMIN" } }) },
    "@/lib/email": { sendLowStockEmail: async () => {} },
    "@/lib/inventory-alerts": {
      rearmLowStockAlerts: async (client: unknown, ids: string[]) => {
        rearmCalls.push([client === db, ids]);
        await options.rearm?.();
      },
    },
    "next/cache": { revalidatePath: (value: string) => paths.push(value) },
    "@/lib/db": { db },
  });
  const { PUT, DELETE } = load("app/api/products/[id]/route.ts");
  const body = {
    name: "Blue mug", slug: "blue-mug", description: "A very blue mug", price: 9.5, category: "Home", stock: 40,
    image: "https://res.cloudinary.com/test/image/upload/a.png", images: [], featured: false,
  };
  return {
    calls,
    paths,
    rearmCalls,
    remove: (hard: boolean) =>
      DELETE(new Request(`http://localhost/api/products/p1${hard ? "?hard=true" : ""}`, { method: "DELETE" }), { params: { id: "p1" } }),
    save: (changes: object = {}) =>
      PUT(new Request("http://localhost/api/products/p1", { method: "PUT", body: JSON.stringify({ ...body, ...changes }) }), { params: { id: "p1" } }),
  };
}

test("hard delete is refused with 409 when the product appears in orders", async () => {
  const { calls, paths, remove } = productIdRoute({ orderItems: 3 });
  const response = await remove(true);
  assert.equal(response.status, 409);
  const { error } = await response.json();
  assert.match(error, /appears in 3 order\(s\)/);
  assert.match(error, /Archive it instead/);
  assert.deepEqual(calls, []);
  assert.deepEqual(paths, []);
});

test("hard delete and archive revalidate the catalog, home and product page", async () => {
  const hard = productIdRoute();
  assert.equal((await hard.remove(true)).status, 200);
  assert.deepEqual(hard.calls, ["delete"]);
  assert.deepEqual(hard.paths.sort(), ["/", "/products", "/products/blue-mug"]);

  // An ordered product can still be archived.
  const archive = productIdRoute({ orderItems: 5 });
  assert.equal((await archive.remove(false)).status, 200);
  assert.deepEqual(archive.calls, ["archive"]);
  assert.ok(archive.paths.includes("/products/blue-mug"));
});

test("hard delete maps a foreign key race and a missing product to friendly errors", async () => {
  const race = await productIdRoute({ deleteError: { code: "P2003" } }).remove(true);
  assert.equal(race.status, 409);
  assert.match((await race.json()).error, /Archive it instead/);
  const missing = await productIdRoute({ deleteError: { code: "P2025" } }).remove(true);
  assert.equal(missing.status, 404);
  const originalError = console.error;
  const logs: string[] = [];
  console.error = (...values: unknown[]) => { logs.push(values.map(String).join(" ")); };
  try {
    const unknown = await productIdRoute({ deleteError: new Error("secret connection string") }).remove(true);
    assert.equal(unknown.status, 500);
    assert.doesNotMatch(await unknown.text(), /secret/);
    assert.equal(logs.length, 1);
    assert.doesNotMatch(logs[0], /secret/);
  } finally {
    console.error = originalError;
  }
});

test("product PUT revalidates the old and the new slug after a rename", async () => {
  const same = productIdRoute();
  assert.equal((await same.save()).status, 200);
  assert.deepEqual(same.paths.sort(), ["/", "/products", "/products/blue-mug"]);

  const renamed = productIdRoute();
  assert.equal((await renamed.save({ slug: "navy-mug" })).status, 200);
  assert.deepEqual(renamed.paths.sort(), ["/", "/products", "/products/blue-mug", "/products/navy-mug"]);
});

test("product PUT re-arms low-stock alerts and still succeeds when that fails", async () => {
  const ok = productIdRoute();
  assert.equal((await ok.save()).status, 200);
  assert.deepEqual(ok.rearmCalls, [[true, ["p1"]]]);

  const originalWarn = console.warn;
  const logs: string[] = [];
  console.warn = (...values: unknown[]) => { logs.push(values.map(String).join(" ")); };
  try {
    const failing = productIdRoute({ rearm: async () => { throw new Error("alerts down for buyer@example.test"); } });
    const response = await failing.save({ slug: "navy-mug" });
    assert.equal(response.status, 200);
    assert.ok(failing.paths.includes("/products/navy-mug"));
    assert.equal(logs.length, 1);
    assert.match(logs[0], /Low stock alert re-arm failed/);
    assert.doesNotMatch(logs[0], /buyer@example\.test/);
  } finally {
    console.warn = originalWarn;
  }

  const missing = productIdRoute({ updateError: { code: "P2025" } });
  assert.equal((await missing.save()).status, 404);
  assert.deepEqual(missing.rearmCalls, []);
});

function imageModules() {
  const load = moduleLoader({
    "./image-hosts.json": imageHosts,
    "next/image": { __esModule: true, default: () => null },
  });
  return { hosts: load("lib/image-hosts.ts"), StoreImage: load("components/ui/StoreImage.tsx").StoreImage };
}

test("image hosts: configured hosts are optimized, every other absolute URL is not", () => {
  const { hosts } = imageModules();
  for (const src of [
    "https://res.cloudinary.com/demo/image/upload/a.png",
    "https://images.unsplash.com/photo-1",
    "https://i.imgur.com/a.png",
    "/uploads/a.png",
  ]) {
    assert.equal(hosts.isOptimizedImageSrc(src), true, src);
  }
  for (const src of [
    "https://cdn.shopify.com/a.png",
    "http://i.imgur.com/a.png",
    "https://res.cloudinary.com.evil.example/a.png",
    "//cdn.example.test/a.png",
    "not a url",
  ]) {
    assert.equal(hosts.isOptimizedImageSrc(src), false, src);
  }
});

test("StoreImage renders unknown hosts unoptimized and lets callers override", () => {
  const { StoreImage } = imageModules();
  // StoreImage is a plain function component, so calling it returns the next/image element.
  const unoptimized = (props: object) =>
    (StoreImage({ alt: "x", width: 10, height: 10, ...props } as any) as any).props.unoptimized;
  assert.equal(unoptimized({ src: "https://cdn.shopify.com/a.png" }), true);
  assert.equal(unoptimized({ src: "https://i.imgur.com/a.png" }), false);
  assert.equal(unoptimized({ src: "/uploads/a.png" }), false);
  assert.equal(unoptimized({ src: "https://i.imgur.com/a.png", unoptimized: true }), true);
});

test("next.config.js shares the image host list and shop components use StoreImage", () => {
  const nextConfig = createRequire(import.meta.url)(path.join(root, "next.config.js"));
  assert.deepEqual(nextConfig.images.remotePatterns, imageHosts);
  assert.equal(nextConfig.images.domains, undefined);
  for (const file of [
    "components/shop/product-card.tsx",
    "components/shop/ProductGallery.tsx",
    "components/shop/cart-item.tsx",
    "components/shop/order-summary.tsx",
    "components/shop/product-grid.tsx",
    "components/shop/product-reviews.tsx",
    "app/(shop)/products/[slug]/page.tsx",
  ]) {
    assert.doesNotMatch(readFileSync(path.join(root, file), "utf8"), /from ["']next\/image["']/, file);
  }
});

function walk(node: any, visit: (element: any) => void): void {
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, visit));
    return;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return;
  visit(node);
  walk(node.props?.children, visit);
}

function productPage(product: any) {
  const stub = (name: string) => Object.assign(() => null, { displayName: name });
  const components = {
    AddToCartButton: stub("AddToCartButton"),
    ProductReviews: stub("ProductReviews"),
    ProductCard: stub("ProductCard"),
    WishlistButton: stub("WishlistButton"),
    ProductGallery: stub("ProductGallery"),
    ProductDescription: stub("ProductDescription"),
  };
  const load = moduleLoader({
    "@/lib/reservation-cleanup": { releaseExpiredReservationsForStorefront: async () => {} },
    "@/lib/db": { db: { product: { findUnique: async () => product, findMany: async () => [] } } },
    "@/lib/email": { sendLowStockEmail: async () => {} },
    "next/navigation": { notFound() { throw new Error("NOT_FOUND"); } },
    "@/components/shop/add-to-cart-button": { AddToCartButton: components.AddToCartButton },
    "@/components/shop/product-reviews": { ProductReviews: components.ProductReviews },
    "@/components/shop/product-card": { ProductCard: components.ProductCard },
    "@/components/ui/WishlistButton": { WishlistButton: components.WishlistButton },
    "@/components/shop/ProductGallery": { ProductGallery: components.ProductGallery },
    "@/components/shop/ProductDescription": { ProductDescription: components.ProductDescription },
  });
  return { components, ...load("app/(shop)/products/[slug]/page.tsx") };
}

const baseProduct = {
  id: "p1", slug: "blue-mug", name: "Blue mug", description: "A very blue mug", price: 9.5, currency: "USD",
  category: "Home", image: "https://i.imgur.com/a.png", images: [], rating: 4, isArchived: false,
};

test("archived product page is noindex, shows an unavailable banner and read-only reviews", async () => {
  const archived = productPage({ ...baseProduct, isArchived: true });
  assert.deepEqual((await archived.generateMetadata({ params: { slug: "blue-mug" } })).robots, { index: false, follow: false });
  const types: any[] = [];
  let reviews: any;
  walk(await archived.default({ params: { slug: "blue-mug" } }), (element) => {
    types.push(element.type);
    if (element.type === archived.components.ProductReviews) reviews = element;
  });
  assert.equal(types.includes(archived.components.AddToCartButton), false);
  assert.equal(reviews.props.readOnly, true);
  let banner = false;
  walk(await archived.default({ params: { slug: "blue-mug" } }), (element) => {
    if (element.props?.role === "status") banner = true;
  });
  assert.equal(banner, true);

  const active = productPage(baseProduct);
  assert.equal((await active.generateMetadata({ params: { slug: "blue-mug" } })).robots, undefined);
  const activeTypes: any[] = [];
  let activeReviews: any;
  walk(await active.default({ params: { slug: "blue-mug" } }), (element) => {
    activeTypes.push(element.type);
    if (element.type === active.components.ProductReviews) activeReviews = element;
  });
  assert.equal(activeTypes.includes(active.components.AddToCartButton), true);
  assert.equal(activeReviews.props.readOnly, false);
});

test("storefront catalog is URL driven, paginated and survives API error payloads", async () => {
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
  install("IS_REACT_ACT_ENVIRONMENT", true);
  dom.window.scrollTo = () => {};
  let root: ReturnType<typeof import("react-dom/client").createRoot> | undefined;
  try {
    let query = "category=Home&minPrice=5&page=2";
    const urls: string[] = [];
    const navigations: string[] = [];
    let respond: () => Response = () => Response.json({ products: [{ id: "p1", name: "Blue mug" }], total: 30, page: 2, pageSize: 12 });
    install("fetch", async (url: string) => {
      urls.push(url);
      return respond();
    });
    const load = moduleLoader({
      "next/navigation": {
        useSearchParams: () => new URLSearchParams(query),
        usePathname: () => "/products",
        useRouter: () => ({
          push: (url: string) => navigations.push(url),
          replace: (url: string) => navigations.push(url),
        }),
      },
      "@/components/providers/settings-provider": {
        useSettings: () => ({ settings: { enabledCategories: ["Home", "Garden"] }, currency: "USD" }),
      },
      "@/components/shop/product-grid": {
        ProductGrid: ({ products }: any) => React.createElement("ul", { "data-testid": "grid" }, products.map((p: any) => React.createElement("li", { key: p.id }, p.name))),
      },
    });
    const { createRoot } = await import("react-dom/client");
    const container = dom.window.document.getElementById("root") as HTMLElement;
    root = createRoot(container);
    const Page = load("app/(shop)/products/page.tsx").default;
    await act(async () => { root!.render(React.createElement(Page)); });

    // Filters and page come from the URL; no implicit price ceiling is sent.
    const api = new URLSearchParams(urls[0].split("?")[1]);
    assert.equal(api.get("category"), "Home");
    assert.equal(api.get("minPrice"), "5");
    assert.equal(api.get("maxPrice"), null);
    assert.equal(api.get("page"), "2");
    assert.equal(api.get("pageSize"), "12");
    assert.match(container.textContent || "", /Blue mug/);
    assert.match(container.textContent || "", /Page 2 of 3/);

    // Categories come from the settings and the URL category stays selected.
    const select = container.querySelector("select") as HTMLSelectElement;
    assert.deepEqual(Array.from(select.options).map((o) => o.value), ["", "Home", "Garden"]);
    assert.equal(select.value, "Home");

    // Clearing a price input yields an empty string, never NaN.
    const min = container.querySelector('input[placeholder="Min price"]') as HTMLInputElement;
    assert.equal(min.value, "5");
    await act(async () => { Simulate.change(min, { target: { value: "" } } as any); });
    assert.equal(min.value, "");

    // Pagination navigates through the URL.
    const next = Array.from(container.querySelectorAll("button")).find((b) => /Next/.test(b.textContent || ""))!;
    await act(async () => { Simulate.click(next); });
    assert.deepEqual(navigations.at(-1), "/products?category=Home&minPrice=5&page=3");

    // An error payload must not be stored as the product list.
    respond = () => Response.json({ error: "Failed to fetch products" }, { status: 500 });
    query = "category=Garden";
    await act(async () => { root!.render(React.createElement(Page)); });
    assert.match(container.textContent || "", /Failed to fetch products/);
    assert.equal(container.querySelector('[data-testid="grid"]'), null);
    assert.ok(Array.from(container.querySelectorAll("button")).some((b) => b.textContent === "Try again"));
  } finally {
    if (root) await act(async () => { root!.unmount(); });
    dom.window.close();
    for (const [key, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
