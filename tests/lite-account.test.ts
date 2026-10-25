import assert from "node:assert/strict";
import test from "node:test";
import { moduleLoader } from "./helpers/load-module";

const request = (body: unknown) => new Request("https://store.example.test/api/test", { method: "POST", body: JSON.stringify(body) });
const quietLogger = { logger: { info() {}, warn() {}, error() {} } };

function setEnv(values: Record<string, string | undefined>) {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else (process.env as Record<string, string>)[key] = value;
  }
  return () => setEnv(saved);
}

test("login finds legacy mixed-case rows and rejects tokens issued before a session version bump", async () => {
  let config: any;
  let sessionVersion = 0;
  const row = { id: "user-1", email: "Legacy@Example.Test", password: "hash", role: "CUSTOMER", name: "Legacy", image: null };
  const lookups: any[] = [];
  const load = moduleLoader({
    "next-auth": (options: any) => { config = options; return {}; },
    "next-auth/providers/google": (options: any) => ({ id: "google", ...options }),
    "next-auth/providers/credentials": (options: any) => ({ id: "credentials", ...options }),
    "@auth/prisma-adapter": { PrismaAdapter: () => ({}) },
    "./db": { db: { user: {
      findUnique: async ({ where }: any) => { lookups.push(where); return where.id === "user-1" ? { ...row, sessionVersion } : where.email === row.email ? { ...row, sessionVersion } : null; },
      findFirst: async ({ where }: any) => (where.email.equals.toLowerCase() === row.email.toLowerCase() ? { ...row, sessionVersion } : null),
    } } },
    "bcryptjs": { compare: async () => true },
    "./rate-limit": { checkRateLimit: async () => ({ success: true }) },
  });
  load("lib/auth.ts");
  const credentials = config.providers.find((provider: any) => provider.id === "credentials");
  const user = await credentials.authorize({ email: "  LEGACY@example.test ", password: "password123" }, new Request("https://store.example.test/login"));
  assert.equal(user.id, "user-1");
  assert.equal(user.email, "Legacy@Example.Test");

  const token = await config.callbacks.jwt({ token: {}, user });
  assert.equal(token.sessionVersion, 0);
  assert.ok(await config.callbacks.jwt({ token }));
  sessionVersion = 1; // password reset or change
  assert.equal(await config.callbacks.jwt({ token }), null);
});

test("register treats case-insensitive and concurrent duplicates as 409", async () => {
  let createError: any = null;
  const created: any[] = [];
  const load = moduleLoader({
    "@/lib/db": { db: { user: {
      findUnique: async () => null,
      findFirst: async ({ where }: any) => (where.email.equals.toLowerCase() === "taken@example.test" ? { id: "user-1" } : null),
      create: async ({ data }: any) => { if (createError) throw createError; created.push(data); return { id: "user-2", ...data }; },
    } } },
    "@/lib/rate-limit": { checkRateLimit: async () => ({ success: true }) },
    "@/lib/logger": quietLogger,
    "bcryptjs": { hash: async () => "hash" },
  });
  const { POST } = load("app/api/auth/register/route.ts");
  const body = (email: string) => ({ name: "Customer", email, password: "password123" });
  assert.equal((await POST(request(body("Taken@Example.Test")))).status, 409);
  assert.equal(created.length, 0);
  assert.equal((await POST(request(body(" New@Example.Test ")))).status, 201);
  assert.equal(created[0].email, "new@example.test");
  createError = Object.assign(new Error("unique"), { code: "P2002" });
  const raced = await POST(request(body("other@example.test")));
  assert.equal(raced.status, 409);
  assert.deepEqual(await raced.json(), { message: "Email already in use" });
});

test("forgot password sends to the stored address with the configured link and store settings", async () => {
  const restore = setEnv({ RESEND_API_KEY: "isolated-key", NEXT_PUBLIC_APP_URL: "https://shop.example.test/", NODE_ENV: "production" });
  try {
    const sent: any[] = [];
    const updates: any[] = [];
    const settings = { storeName: "Corner Shop" };
    const load = moduleLoader({
      "@/lib/db": { db: { user: {
        findUnique: async () => null,
        findFirst: async ({ where }: any) => (where.email.equals === "mixed@example.test" ? { id: "user-1", email: "Mixed@Example.Test" } : null),
        update: async (args: any) => { updates.push(args); return {}; },
      } } },
      "@/lib/rate-limit": { checkRateLimit: async () => ({ success: true }) },
      "@/lib/email": { sendPasswordResetEmail: async (...args: any[]) => { sent.push(args); } },
      "@/lib/store-settings": { getStoreSettings: async () => settings },
      "@/lib/logger": quietLogger,
    });
    const { POST } = load("app/api/auth/forgot-password/route.ts");
    const response = await POST(request({ email: "  MIXED@Example.test " }));
    assert.equal(response.status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0][0], "Mixed@Example.Test");
    assert.match(sent[0][1], /^https:\/\/shop\.example\.test\/reset-password\?token=[a-f0-9]{64}$/);
    assert.equal(sent[0][2], settings);
    assert.equal(updates[0].where.id, "user-1");
    assert.notEqual(updates[0].data.resetToken, sent[0][1].split("token=")[1]);

    const unknown = await POST(request({ email: "nobody@example.test" }));
    assert.equal(unknown.status, 200);
    assert.deepEqual(await unknown.json(), await response.json());
    assert.equal(sent.length, 1);
  } finally {
    restore();
  }
});

test("forgot password never sends a localhost link in production and falls back to it in development", async () => {
  const restore = setEnv({ RESEND_API_KEY: "isolated-key", NEXT_PUBLIC_APP_URL: undefined, NEXT_PUBLIC_STORE_URL: undefined, NEXT_PUBLIC_SITE_URL: undefined, NODE_ENV: "production" });
  try {
    const sent: any[] = [];
    const updates: any[] = [];
    const warnings: string[] = [];
    const load = moduleLoader({
      "@/lib/db": { db: { user: {
        findUnique: async () => ({ id: "user-1", email: "owner@example.test" }),
        update: async (args: any) => { updates.push(args); return {}; },
      } } },
      "@/lib/rate-limit": { checkRateLimit: async () => ({ success: true }) },
      "@/lib/email": { sendPasswordResetEmail: async (...args: any[]) => { sent.push(args); } },
      "@/lib/store-settings": { getStoreSettings: async () => null },
      "@/lib/logger": { logger: { info() {}, error() {}, warn: (message: string) => { warnings.push(message); } } },
    });
    const { POST } = load("app/api/auth/forgot-password/route.ts");
    assert.equal((await POST(request({ email: "owner@example.test" }))).status, 200);
    assert.equal(sent.length, 0);
    assert.equal(updates.length, 0);
    assert.equal(warnings.length, 1);

    (process.env as Record<string, string>).NODE_ENV = "development";
    assert.equal((await POST(request({ email: "owner@example.test" }))).status, 200);
    assert.match(sent[0][1], /^http:\/\/localhost:3000\/reset-password\?token=/);
  } finally {
    restore();
  }
});

test("reset password uses its own rate-limit bucket and bumps the session version", async () => {
  const buckets: string[] = [];
  let data: any;
  const load = moduleLoader({
    "@/lib/rate-limit": { checkRateLimit: async (_id: string, type: string) => { buckets.push(type); return { success: true }; } },
    "@/lib/logger": quietLogger,
    "bcryptjs": { hash: async () => "password-hash" },
    "@/lib/db": { db: { user: {
      findFirst: async () => ({ id: "user-1" }),
      updateMany: async (args: any) => { data = args.data; return { count: 1 }; },
    } } },
  });
  const response = await load("app/api/auth/reset-password/route.ts").POST(request({ token: "a".repeat(64), password: "password123" }));
  assert.equal(response.status, 200);
  assert.deepEqual(buckets, ["resetPassword"]);
  assert.deepEqual(data.sessionVersion, { increment: 1 });
  assert.equal(data.resetToken, null);
});

test("exhausting forgot-password requests does not block using a reset link", async () => {
  const restore = setEnv({ UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined });
  try {
    const { checkRateLimit } = moduleLoader({ "./redis": { redis: null }, "@upstash/ratelimit": { Ratelimit: class {} } })("lib/rate-limit.ts");
    for (let attempt = 0; attempt < 3; attempt++) assert.equal((await checkRateLimit("1.2.3.4", "forgotPassword")).success, true);
    assert.equal((await checkRateLimit("1.2.3.4", "forgotPassword")).success, false);
    assert.equal((await checkRateLimit("1.2.3.4", "resetPassword")).success, true);
  } finally {
    restore();
  }
});

function profileHarness(options: { role?: string; password?: string | null } = {}) {
  const updates: any[] = [];
  const signOuts: any[] = [];
  const load = moduleLoader({
    "@/lib/auth": {
      auth: async () => ({ user: { id: "user-1" } }),
      signOut: async (args: any) => { signOuts.push(args); },
    },
    "@/lib/db": { db: { user: {
      findUnique: async () => ({ id: "user-1", email: "owner@example.test", role: options.role ?? "CUSTOMER", password: options.password === undefined ? "old-hash" : options.password }),
      update: async (args: any) => { updates.push(args); return {}; },
    } } },
    "@/lib/logger": quietLogger,
    "bcryptjs": { compare: async (value: string) => value === "old-password", hash: async () => "new-hash" },
    "next/cache": { revalidatePath() {} },
  });
  return { actions: load("app/profile/actions.ts"), updates, signOuts };
}

test("profile validates input, bumps the session version on password change and signs the session out", async () => {
  const h = profileHarness();
  await assert.rejects(h.actions.updateProfile({ name: "x".repeat(51) }), /Name must be between 1 and 50/);
  await assert.rejects(h.actions.updateProfile({ currentPassword: "old-password", newPassword: "short" }), /at least|between 8 and 100/);
  await assert.rejects(h.actions.updateProfile({ newPassword: "new-password-1" }), /Current password is required/);
  await assert.rejects(h.actions.updateProfile({ currentPassword: "wrong", newPassword: "new-password-1" }), /Invalid current password/);
  assert.equal(h.updates.length, 0);

  await h.actions.updateProfile({ name: "  New Name  ", currentPassword: "", newPassword: "" });
  assert.deepEqual(h.updates[0].data, { name: "New Name" });
  assert.equal(h.signOuts.length, 0);

  await h.actions.updateProfile({ currentPassword: "old-password", newPassword: "new-password-1" });
  assert.equal(h.updates[1].data.password, "new-hash");
  assert.deepEqual(h.updates[1].data.sessionVersion, { increment: 1 });
  assert.deepEqual(h.signOuts, [{ redirectTo: "/login?passwordChanged=1" }]);
});

function deletionHarness(options: { role?: string; email?: string } = {}) {
  const calls: [string, any][] = [];
  const signOuts: any[] = [];
  const record = (name: string, result: unknown = { count: 0 }) => async (args: any) => { calls.push([name, args]); return result; };
  const tx = {
    user: { findUnique: record("user.findUnique", { id: "user-1", email: "owner@example.test" }), delete: record("user.delete", {}) },
    order: { updateMany: record("order.updateMany") },
    address: { updateMany: record("address.updateMany"), deleteMany: record("address.deleteMany") },
    cart: { deleteMany: record("cart.deleteMany") },
    wishlist: { deleteMany: record("wishlist.deleteMany") },
    review: {
      findMany: record("review.findMany", [{ productId: "p1" }, { productId: "p1" }, { productId: "p2" }]),
      deleteMany: record("review.deleteMany"),
      aggregate: async ({ where }: any) => { calls.push(["review.aggregate", where]); return { _avg: { rating: null } }; },
    },
    product: { updateMany: record("product.updateMany") },
  };
  const load = moduleLoader({
    "@/lib/auth": { auth: async () => ({ user: { id: "user-1" } }), signOut: async (args: any) => { signOuts.push(args); } },
    "@/lib/db": { db: {
      user: { findUnique: async () => ({ role: options.role ?? "CUSTOMER", email: options.email ?? "owner@example.test" }) },
      $transaction: async (fn: any) => fn(tx),
    } },
    "@/lib/logger": quietLogger,
    "bcryptjs": {},
    "next/cache": { revalidatePath() {} },
  });
  return { actions: load("app/profile/actions.ts"), calls, signOuts };
}

test("account deletion keeps and detaches orders and used addresses, removes personal data and recalculates ratings", async () => {
  const restore = setEnv({ ADMIN_EMAIL: "boss@example.test" });
  try {
    const h = deletionHarness();
    assert.equal(await h.actions.deleteAccount(), undefined);
    const names = h.calls.map(([name]) => name);
    const orderUpdates = h.calls.filter(([name]) => name === "order.updateMany").map(([, args]) => args);
    assert.deepEqual(orderUpdates[0].data, { guestEmail: "owner@example.test", userId: null });
    assert.deepEqual(orderUpdates[1].data, { userId: null });
    // Only detaching: no status, stock or reservation fields are touched on orders.
    assert.ok(orderUpdates.every((args) => Object.keys(args.data).every((key) => ["userId", "guestEmail"].includes(key))));
    const keptAddresses = h.calls.find(([name]) => name === "address.updateMany")![1];
    assert.deepEqual(keptAddresses.data, { userId: null });
    assert.ok(keptAddresses.where.OR);
    assert.ok(names.indexOf("address.updateMany") < names.indexOf("address.deleteMany"));
    for (const step of ["cart.deleteMany", "wishlist.deleteMany", "review.deleteMany"]) assert.ok(names.includes(step), step);
    assert.ok(names.indexOf("order.updateMany") < names.indexOf("user.delete"));
    assert.ok(names.indexOf("review.deleteMany") < names.indexOf("user.delete"));
    // One recalculation per affected product, after the user is gone.
    const recalculated = h.calls.filter(([name]) => name === "product.updateMany").map(([, args]) => args.where.id);
    assert.deepEqual(recalculated, ["p1", "p2"]);
    assert.ok(names.indexOf("user.delete") < names.indexOf("product.updateMany"));
    assert.deepEqual(h.signOuts, [{ redirectTo: "/" }]);
  } finally {
    restore();
  }
});

test("account deletion is refused for ADMIN role and the ADMIN_EMAIL account", async () => {
  const restore = setEnv({ ADMIN_EMAIL: " Boss@Example.Test " });
  try {
    for (const options of [{ role: "ADMIN" }, { email: "boss@example.test" }]) {
      const h = deletionHarness(options);
      const result = await h.actions.deleteAccount();
      assert.equal(result.success, false);
      assert.match(result.error, /cannot be deleted/);
      assert.equal(h.calls.length, 0);
      assert.equal(h.signOuts.length, 0);
    }
  } finally {
    restore();
  }
});
