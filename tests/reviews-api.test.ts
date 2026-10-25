import assert from "node:assert/strict";
import test from "node:test";
import { moduleLoader } from "./helpers/load-module";

function reviewsRoute(options: {
  session?: any;
  product?: any;
  createError?: unknown;
  review?: any;
  rateLimit?: { success: boolean; unavailable?: boolean };
} = {}) {
  const log: Array<[string, any]> = [];
  const hasSession = options.session !== null;
  const tx = {
    review: {
      create: async (args: any) => {
        log.push(["create", args]);
        if (options.createError) throw options.createError;
        return { id: "r1", ...args.data };
      },
      delete: async (args: any) => log.push(["delete", args]),
      aggregate: async (args: any) => {
        log.push(["aggregate", args]);
        return { _avg: { rating: 4.256 } };
      },
    },
    product: { updateMany: async (args: any) => log.push(["rating", args]) },
  };
  const load = moduleLoader({
    "@/lib/auth": { auth: async () => (hasSession ? options.session ?? { user: { id: "u1", role: "CUSTOMER" } } : null) },
    "@/lib/rate-limit": { checkRateLimit: async () => options.rateLimit ?? { success: true } },
    "next/cache": { revalidatePath: (path: string) => log.push(["revalidate", path]) },
    "@/lib/db": {
      db: {
        product: {
          findUnique: async () => (options.product === undefined ? { id: "p1", slug: "blue-mug", isArchived: false } : options.product),
        },
        review: {
          findUnique: async () => options.review ?? null,
        },
        $transaction: async (fn: any) => {
          log.push(["transaction", null]);
          return fn(tx);
        },
      },
    },
  });
  return { route: load("app/api/products/[id]/reviews/route.ts"), log };
}

const post = (route: any, body: unknown) =>
  route.POST(new Request("http://localhost/api/products/p1/reviews", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }), {
    params: { id: "p1" },
  });
const names = (log: Array<[string, any]>) => log.map(([name]) => name);

test("review POST requires a logged-in user and honours the rate limit", async () => {
  const anonymous = reviewsRoute({ session: null });
  const unauthorized = await post(anonymous.route, { rating: 5, comment: "Great" });
  assert.equal(unauthorized.status, 401);
  assert.equal(typeof (await unauthorized.json()).error, "string");

  const limited = reviewsRoute({ rateLimit: { success: false } });
  assert.equal((await post(limited.route, { rating: 5, comment: "Great" })).status, 429);
  assert.deepEqual(names(limited.log), []);
});

test("review POST rejects out-of-range, fractional and malformed input before touching the database", async () => {
  const invalid: unknown[] = [
    { rating: -1000, comment: "Terrible" },
    { rating: 999, comment: "Overflows Decimal(3,2)" },
    { rating: 0, comment: "Zero" },
    { rating: 6, comment: "Six" },
    { rating: 4.5, comment: "Fractional" },
    { rating: "5", comment: "String rating" },
    { rating: null, comment: "Null rating" },
    { comment: "Missing rating" },
    { rating: 5, comment: "" },
    { rating: 5, comment: "   " },
    { rating: 5 },
    { rating: 5, comment: "x".repeat(2001) },
    { rating: 5, comment: "Fine", title: "t".repeat(101) },
    "{not json",
  ];
  for (const body of invalid) {
    const { route, log } = reviewsRoute();
    const response = await post(route, body);
    assert.equal(response.status, 400, JSON.stringify(body)?.slice(0, 60));
    assert.equal(typeof (await response.json()).error, "string");
    assert.deepEqual(names(log), [], "no database work for invalid input");
  }
});

test("review POST refuses missing and archived products", async () => {
  const missing = reviewsRoute({ product: null });
  assert.equal((await post(missing.route, { rating: 5, comment: "Nice" })).status, 404);
  const archived = reviewsRoute({ product: { id: "p1", slug: "blue-mug", isArchived: true } });
  const response = await post(archived.route, { rating: 5, comment: "Nice" });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /no longer available/);
  assert.ok(!names(archived.log).includes("create"));
});

test("review POST creates the review and recalculates the rating in one transaction", async () => {
  const { route, log } = reviewsRoute();
  const response = await post(route, { rating: 4, title: "  Solid ", comment: "  Works well  " });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.rating, 4);
  assert.equal(body.comment, "Works well");
  assert.equal(body.title, "Solid");
  assert.equal(body.userId, "u1");
  assert.deepEqual(names(log).slice(0, 4), ["transaction", "create", "aggregate", "rating"]);
  assert.deepEqual(log.find(([name]) => name === "rating")![1], { where: { id: "p1" }, data: { rating: 4.26 } });
  assert.ok(log.some(([name, path]) => name === "revalidate" && path === "/products/blue-mug"));
});

test("a second review by the same user returns a friendly 409", async () => {
  const { route, log } = reviewsRoute({ createError: { code: "P2002" } });
  const response = await post(route, { rating: 5, comment: "Again" });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "You have already reviewed this product.");
  assert.ok(!names(log).includes("rating"));
});

const remove = (route: any, reviewId?: string) =>
  route.DELETE(new Request(`http://localhost/api/products/p1/reviews${reviewId ? `?reviewId=${reviewId}` : ""}`, { method: "DELETE" }), {
    params: { id: "p1" },
  });

test("review DELETE is admin-only and requires a review id", async () => {
  const customer = reviewsRoute();
  assert.equal((await remove(customer.route, "r1")).status, 401);
  const admin = reviewsRoute({ session: { user: { id: "a1", role: "ADMIN" } } });
  assert.equal((await remove(admin.route)).status, 400);
});

test("review DELETE rejects a review that belongs to another product", async () => {
  const { route, log } = reviewsRoute({
    session: { user: { id: "a1", role: "ADMIN" } },
    review: { id: "r9", productId: "other-product", product: { slug: "other" } },
  });
  const response = await remove(route, "r9");
  assert.equal(response.status, 404);
  assert.ok(!names(log).includes("delete"));
  const unknown = reviewsRoute({ session: { user: { id: "a1", role: "ADMIN" } } });
  assert.equal((await remove(unknown.route, "nope")).status, 404);
});

test("review DELETE recalculates in a transaction and revalidates the slug path", async () => {
  const { route, log } = reviewsRoute({
    session: { user: { id: "a1", role: "ADMIN" } },
    review: { id: "r1", productId: "p1", product: { slug: "blue-mug" } },
  });
  const response = await remove(route, "r1");
  assert.equal(response.status, 204);
  assert.deepEqual(names(log).slice(0, 4), ["transaction", "delete", "aggregate", "rating"]);
  const paths = log.filter(([name]) => name === "revalidate").map(([, path]) => path);
  assert.ok(paths.includes("/products/blue-mug"));
  assert.ok(!paths.includes("/products/p1"));
});
