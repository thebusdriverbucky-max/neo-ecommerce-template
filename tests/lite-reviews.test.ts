import assert from "node:assert/strict";
import test from "node:test";
import { moduleLoader } from "./helpers/load-module";

const params = { params: { id: "product-1" } };
const post = (body: unknown) => new Request("https://store.example.test/api/products/product-1/reviews", { method: "POST", body: JSON.stringify(body) });
const validReview = { rating: 4, title: "  Solid  ", comment: "  Works well  " };

function harness(options: { product?: any; createError?: any; role?: string; review?: any; deleteError?: any; average?: number | null } = {}) {
  const calls: [string, any][] = [];
  const revalidated: string[] = [];
  const product = "product" in options ? options.product : { id: "product-1", slug: "blue-mug", isArchived: false };
  const tx = {
    review: {
      create: async (args: any) => { calls.push(["review.create", args]); if (options.createError) throw options.createError; return { id: "review-1", ...args.data }; },
      delete: async (args: any) => { calls.push(["review.delete", args]); if (options.deleteError) throw options.deleteError; return {}; },
      aggregate: async (args: any) => { calls.push(["review.aggregate", args]); return { _avg: { rating: options.average === undefined ? 4.3333 : options.average } }; },
    },
    product: { updateMany: async (args: any) => { calls.push(["product.updateMany", args]); return { count: 1 }; } },
  };
  const load = moduleLoader({
    "@/lib/auth": { auth: async () => ({ user: { id: "user-1", role: options.role ?? "CUSTOMER" } }) },
    "@/lib/db": { db: {
      product: { findUnique: async () => product },
      review: { findUnique: async () => options.review ?? null },
      $transaction: async (fn: any) => fn(tx),
    } },
    "@/lib/rate-limit": { checkRateLimit: async () => ({ success: true }) },
    "@/lib/logger": { logger: { info() {}, warn() {}, error() {} } },
    "next/cache": { revalidatePath: (path: string) => { revalidated.push(path); } },
  });
  return { route: load("app/api/products/[id]/reviews/route.ts"), calls, revalidated };
}

test("a review is stored with its title and the rounded rating is recalculated in the same transaction", async () => {
  const h = harness();
  const response = await h.route.POST(post(validReview), params);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.title, "Solid");
  assert.equal(body.comment, "Works well");
  assert.deepEqual(h.calls.map(([name]) => name), ["review.create", "review.aggregate", "product.updateMany"]);
  assert.equal(h.calls[2][1].data.rating, 4.33);
  assert.deepEqual(h.revalidated, ["/products/blue-mug", "/products"]);
});

test("review input is validated before any database access", async () => {
  const h = harness();
  const cases: [unknown, string][] = [
    [{ ...validReview, title: "t".repeat(101) }, "title"],
    [{ ...validReview, comment: "c".repeat(2001) }, "comment"],
    [{ ...validReview, comment: "   " }, "comment"],
    [{ ...validReview, rating: 6 }, "rating"],
    [{ ...validReview, rating: 2.5 }, "rating"],
  ];
  for (const [body, field] of cases) {
    const response = await h.route.POST(post(body), params);
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(typeof payload.error, "string");
    assert.ok(payload.fieldErrors[field], field);
  }
  assert.equal(h.calls.length, 0);
});

test("reviews on missing or archived products return 404 and duplicates return 409", async () => {
  assert.equal((await harness({ product: null }).route.POST(post(validReview), params)).status, 404);
  const archived = harness({ product: { id: "product-1", slug: "blue-mug", isArchived: true } });
  assert.equal((await archived.route.POST(post(validReview), params)).status, 404);
  assert.equal(archived.calls.length, 0);

  const duplicate = harness({ createError: Object.assign(new Error("unique"), { code: "P2002" }) });
  const response = await duplicate.route.POST(post(validReview), params);
  assert.equal(response.status, 409);
  assert.equal(duplicate.revalidated.length, 0);
});

test("deleting a review verifies it belongs to the product and recalculates that product", async () => {
  const request = new Request("https://store.example.test/api/products/product-1/reviews?reviewId=review-1", { method: "DELETE" });
  const other = harness({ role: "ADMIN", review: { id: "review-1", productId: "product-2", product: { slug: "other" } } });
  assert.equal((await other.route.DELETE(request, params)).status, 404);
  assert.equal(other.calls.length, 0);

  assert.equal((await harness({ role: "ADMIN", review: null }).route.DELETE(request, params)).status, 404);
  assert.equal((await harness({ role: "CUSTOMER" }).route.DELETE(request, params)).status, 401);

  const raced = harness({ role: "ADMIN", review: { id: "review-1", productId: "product-1", product: { slug: "blue-mug" } }, deleteError: Object.assign(new Error("gone"), { code: "P2025" }) });
  assert.equal((await raced.route.DELETE(request, params)).status, 404);

  const ok = harness({ role: "ADMIN", review: { id: "review-1", productId: "product-1", product: { slug: "blue-mug" } }, average: null });
  assert.equal((await ok.route.DELETE(request, params)).status, 204);
  assert.deepEqual(ok.calls.map(([name]) => name), ["review.delete", "review.aggregate", "product.updateMany"]);
  assert.equal(ok.calls[2][1].data.rating, 0);
  assert.deepEqual(ok.revalidated, ["/products/blue-mug", "/products"]);
});
