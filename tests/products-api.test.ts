import assert from "node:assert/strict";
import test from "node:test";
import { moduleLoader } from "./helpers/load-module";
import { catalogApiQuery, catalogQueryString, pageNumbers, readCatalogState } from "../lib/product-catalog";

function productsRoute(role: string | null, calls: any[] = []) {
  const load = moduleLoader({
    "@/lib/auth": { auth: async () => (role ? { user: { id: "u1", role } } : null) },
    "next/cache": { revalidatePath() {} },
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

test("products GET without page keeps the legacy array, now with stable ordering", async () => {
  const calls: any[] = [];
  const response = await get(productsRoute(null, calls));
  assert.ok(Array.isArray(await response.json()));
  const args = calls[0][1];
  assert.equal(args.take, 50);
  assert.deepEqual(args.orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
  assert.equal(args.where.isArchived, false);
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
  let find = calls.filter(([name]) => name === "findMany").at(-1)![1];
  assert.equal(find.skip, 10);
  assert.equal(find.take, 10);
  assert.deepEqual(find.orderBy, [{ createdAt: "desc" }, { id: "desc" }]);

  const defaults = await (await get(route, "?page=1")).json();
  assert.equal(defaults.pageSize, 24);
  const capped = await (await get(route, "?page=1&pageSize=1000")).json();
  assert.equal(capped.pageSize, 100);
  const sanitized = await (await get(route, "?page=-4&pageSize=abc")).json();
  assert.deepEqual([sanitized.page, sanitized.pageSize], [1, 24]);
  find = calls.filter(([name]) => name === "findMany").at(-1)![1];
  assert.equal(find.skip, 0);
});

test("products GET all=true includes archived products for admins only", async () => {
  for (const role of [null, "CUSTOMER"]) {
    const calls: any[] = [];
    await get(productsRoute(role, calls), "?all=true&page=1");
    assert.equal(calls.find(([name]) => name === "findMany")![1].where.isArchived, false, String(role));
  }
  const calls: any[] = [];
  await get(productsRoute("ADMIN", calls), "?all=true&page=1");
  assert.equal("isArchived" in calls.find(([name]) => name === "findMany")![1].where, false);
});

test("products GET price filters ignore NaN and do not cap high prices", async () => {
  const calls: any[] = [];
  const route = productsRoute(null, calls);
  const where = async (query: string) => {
    calls.length = 0;
    await get(route, query);
    return calls.find(([name]) => name === "findMany")![1].where;
  };
  assert.equal((await where("?minPrice=abc&maxPrice=NaN")).price, undefined);
  assert.equal((await where("?minPrice=&maxPrice=")).price, undefined);
  assert.deepEqual((await where("?minPrice=5&maxPrice=5000000")).price, { gte: 5, lte: 5000000 });
  assert.deepEqual((await where("?maxPrice=Infinity")).price, undefined);
  // Without any bound there is no price clause, so a 2,000,000 product is not excluded.
  assert.equal((await where("")).price, undefined);
});

test("products GET search matches name, slug and description case-insensitively", async () => {
  const calls: any[] = [];
  await get(productsRoute(null, calls), "?page=1&search=%20Blue%20&category=Home");
  const where = calls.find(([name]) => name === "findMany")![1].where;
  assert.equal(where.category, "Home");
  assert.deepEqual(where.OR, [
    { name: { contains: "Blue", mode: "insensitive" } },
    { slug: { contains: "Blue", mode: "insensitive" } },
    { description: { contains: "Blue", mode: "insensitive" } },
  ]);
});

function deleteRoute(options: { orderItems?: number; deleteError?: unknown } = {}) {
  const calls: string[] = [];
  const paths: string[] = [];
  const load = moduleLoader({
    "@/lib/auth": { auth: async () => ({ user: { role: "ADMIN" } }) },
    "@/lib/email": { sendLowStockEmail: async () => {} },
    "next/cache": { revalidatePath: (path: string) => paths.push(path) },
    "@/lib/db": {
      db: {
        orderItem: { count: async () => options.orderItems ?? 0 },
        product: {
          delete: async () => {
            calls.push("delete");
            if (options.deleteError) throw options.deleteError;
            return { id: "p1", slug: "blue-mug" };
          },
          update: async () => {
            calls.push("archive");
            return { id: "p1", slug: "blue-mug" };
          },
        },
      },
    },
  });
  const { DELETE } = load("app/api/products/[id]/route.ts");
  return {
    calls,
    paths,
    remove: (hard: boolean) =>
      DELETE(new Request(`http://localhost/api/products/p1${hard ? "?hard=true" : ""}`, { method: "DELETE" }), { params: { id: "p1" } }),
  };
}

test("hard delete is refused with 409 when the product appears in orders", async () => {
  const { calls, paths, remove } = deleteRoute({ orderItems: 3 });
  const response = await remove(true);
  assert.equal(response.status, 409);
  assert.equal(
    (await response.json()).error,
    "This product appears in 3 order(s) and can't be deleted. Archive it instead — it will be hidden from the store and kept in order history.",
  );
  assert.deepEqual(calls, []);
  assert.deepEqual(paths, []);
});

test("hard delete and archive revalidate the catalog and product page", async () => {
  const hard = deleteRoute();
  assert.equal((await hard.remove(true)).status, 200);
  assert.deepEqual(hard.calls, ["delete"]);
  assert.deepEqual(hard.paths.sort(), ["/", "/products", "/products/blue-mug"]);

  const archive = deleteRoute({ orderItems: 5 });
  assert.equal((await archive.remove(false)).status, 200);
  assert.deepEqual(archive.calls, ["archive"]);
  assert.ok(archive.paths.includes("/products/blue-mug"));
});

test("hard delete maps a foreign key race and a missing product to friendly errors", async () => {
  const race = await deleteRoute({ deleteError: { code: "P2003" } }).remove(true);
  assert.equal(race.status, 409);
  assert.match((await race.json()).error, /Archive it instead/);
  const missing = await deleteRoute({ deleteError: { code: "P2025" } }).remove(true);
  assert.equal(missing.status, 404);
});

test("catalog URL helpers preserve filters and page", () => {
  const filters = { category: "Home", minPrice: "5", maxPrice: "", search: "mug cup" };
  assert.equal(catalogQueryString(filters, 1), "category=Home&minPrice=5&search=mug+cup");
  assert.equal(catalogQueryString(filters, 3), "category=Home&minPrice=5&search=mug+cup&page=3");
  assert.deepEqual(readCatalogState(new URLSearchParams("category=Home&minPrice=5&search=mug+cup&page=3")), { filters, page: 3 });
  assert.deepEqual(readCatalogState(new URLSearchParams("minPrice=abc&page=0")).filters.minPrice, "");
  assert.equal(readCatalogState(new URLSearchParams("page=-2")).page, 1);
  const api = new URLSearchParams(catalogApiQuery(filters, 3));
  assert.equal(api.get("page"), "3");
  assert.equal(api.get("category"), "Home");
  assert.equal(api.get("pageSize"), "12");
  assert.deepEqual(pageNumbers(1, 3), [1, 2, 3]);
  assert.deepEqual(pageNumbers(10, 20), [1, "...", 9, 10, 11, "...", 20]);
});

test("product PUT re-arms low-stock alerts after the stock was raised", async () => {
  const updates: any[] = [];
  const load = moduleLoader({
    "@/lib/auth": { auth: async () => ({ user: { role: "ADMIN" } }) },
    "@/lib/email": { sendLowStockEmail: async () => {} },
    "next/cache": { revalidatePath() {} },
    "@/lib/db": {
      db: {
        product: {
          update: async ({ data }: any) => ({ id: "p1", slug: data.slug }),
          findMany: async () => [{ id: "p1", stock: 40, inventoryAlert: { threshold: 5, lastAlertAt: new Date() } }],
        },
        inventoryAlert: { updateMany: async (args: any) => updates.push(args) },
      },
    },
  });
  const { PUT } = load("app/api/products/[id]/route.ts");
  const body = {
    name: "Blue mug", slug: "blue-mug", description: "A very blue mug", price: 9.5, category: "Home", stock: 40,
    image: "https://res.cloudinary.com/test/image/upload/a.png", images: [], featured: false,
  };
  const response = await PUT(new Request("http://localhost/api/products/p1", { method: "PUT", body: JSON.stringify(body) }), { params: { id: "p1" } });
  assert.equal(response.status, 200);
  assert.deepEqual(updates, [{ where: { productId: { in: ["p1"] } }, data: { lastAlertAt: null } }]);
});
