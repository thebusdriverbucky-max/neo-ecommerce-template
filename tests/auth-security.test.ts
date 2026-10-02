import assert from "node:assert/strict";
import test from "node:test";
import { moduleLoader } from "./helpers/load-module";

function authHarness() {
  let config: any;
  let role = "CUSTOMER";
  let fail = false;
  let allowed = true;
  const load = moduleLoader({
    "next-auth": (options: any) => { config = options; return {}; },
    "next-auth/providers/google": (options: any) => ({ id: "google", ...options }),
    "next-auth/providers/credentials": (options: any) => ({ id: "credentials", ...options }),
    "@auth/prisma-adapter": { PrismaAdapter: () => ({}) },
    "./db": { db: { user: { findUnique: async () => {
      if (fail) throw new Error("Unavailable");
      return { id: "user-1", email: "owner@example.test", password: "hash", role };
    } } } },
    "bcryptjs": { compare: async () => true },
    "./rate-limit": { checkRateLimit: async () => ({ success: allowed }) },
  });
  load("lib/auth.ts");
  return { config, load, setRole: (value: string) => { role = value; }, fail: () => { fail = true; }, deny: () => { allowed = false; } };
}

test("ADMIN_EMAIL grants admin access and a different email remains a customer", async () => {
  process.env.ADMIN_EMAIL = "owner@example.test";
  const h = authHarness();
  const token = await h.config.callbacks.jwt({ token: {}, user: { id: "user-1", email: "owner@example.test", role: "CUSTOMER" } });
  assert.equal(token.role, "ADMIN");
  process.env.ADMIN_EMAIL = "other@example.test";
  assert.equal((await h.config.callbacks.jwt({ token })).role, "CUSTOMER");
  h.setRole("ADMIN");
  assert.equal((await h.config.callbacks.jwt({ token })).role, "ADMIN");
  h.fail();
  assert.equal((await h.config.callbacks.jwt({ token })).role, "CUSTOMER");
  const edge = h.load("lib/auth.config.ts").authConfig;
  const oldSession = await edge.callbacks.session({ session: { user: {} }, token: { id: "user-1", role: "ADMIN" } });
  assert.equal(oldSession.user.role, "CUSTOMER");
  process.env.ADMIN_EMAIL = " OWNER@EXAMPLE.TEST ";
  assert.equal((await edge.callbacks.jwt({ token: {}, user: { id: "user-1", email: "owner@example.test", role: "CUSTOMER" } })).role, "ADMIN");
});

test("Google is registered only with both credentials and never enables email account linking", () => {
  for (const [id, secret, expected] of [["", "", false], ["id", "", false], ["", "secret", false], [" ", "secret", false], ["id", "secret", true]] as const) {
    process.env.GOOGLE_ID = id;
    process.env.GOOGLE_SECRET = secret;
    const google = authHarness().config.providers.find((provider: any) => provider.id === "google");
    assert.equal(Boolean(google), expected);
    if (google) assert.equal(google.allowDangerousEmailAccountLinking, false);
  }
});

test("Google sign-in requires a strictly verified email and credentials sign-in is rate limited", async () => {
  const h = authHarness();
  for (const profile of [undefined, {}, { email: "a@example.test" }, { email: "a@example.test", email_verified: "true" }, { email: "", email_verified: true }]) {
    assert.equal(await h.config.callbacks.signIn({ account: { provider: "google" }, profile }), false);
  }
  assert.equal(await h.config.callbacks.signIn({ account: { provider: "google" }, profile: { email: "a@example.test", email_verified: true } }), true);
  assert.equal(await h.config.callbacks.signIn({ account: { provider: "github" } }), false);
  const credentials = h.config.providers.find((provider: any) => provider.id === "credentials");
  const request = new Request("https://store.example.test/login");
  assert.equal((await credentials.authorize({ email: "owner@example.test", password: "password" }, request)).role, "CUSTOMER");
  h.deny();
  assert.equal(await credentials.authorize({ email: "owner@example.test", password: "password" }, request), null);
});

test("registration normalizes email and leaves role assignment to ADMIN_EMAIL authentication", async () => {
  let written: any;
  const users = new Map<string, any>();
  const load = moduleLoader({
    "@/lib/db": { db: { user: {
      findUnique: async ({ where }: any) => users.get(where.email) ?? null,
      create: async ({ data }: any) => { written = data; const user = { id: `user-${users.size + 1}`, ...data }; users.set(data.email, user); return user; },
    } } },
    "@/lib/rate-limit": { checkRateLimit: async () => ({ success: true }) },
    "bcryptjs": { hash: async () => "hash" },
  });
  process.env.ADMIN_EMAIL = "Owner@Example.Test";
  const route = load("app/api/auth/register/route.ts");
  const response = await route.POST(new Request("https://store.example.test/register", {
    method: "POST", body: JSON.stringify({ name: "Owner", email: "owner@example.test", password: "password123", role: "CUSTOMER", emailVerified: new Date() }),
  }));
  assert.equal(response.status, 201);
  assert.equal(written.email, "owner@example.test");
  assert.equal(written.role, "CUSTOMER");
  assert.equal(written.emailVerified, undefined);
  const customerResponse = await route.POST(new Request("https://store.example.test/register", {
    method: "POST", body: JSON.stringify({ name: "Customer", email: "customer@example.test", password: "password123" }),
  }));
  assert.equal(customerResponse.status, 201);
  assert.equal(written.role, "CUSTOMER");
});
