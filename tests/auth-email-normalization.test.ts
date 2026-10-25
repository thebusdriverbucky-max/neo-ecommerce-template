import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcryptjs";
import { moduleLoader } from "./helpers/load-module";

type UserRow = { id: string; email: string; password: string | null; name: string | null; image: null; role: string; createdAt: Date };

function makeDb(rows: UserRow[]) {
  const calls: { method: string; args: any }[] = [];
  const db = {
    user: {
      findUnique: async (args: any) => (calls.push({ method: "findUnique", args }), rows.find((row) => row.email === args.where.email) ?? null),
      findFirst: async (args: any) => {
        calls.push({ method: "findFirst", args });
        const wanted = String(args.where.email.equals).toLowerCase();
        const matches = rows.filter((row) => row.email.toLowerCase() === wanted);
        return matches.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] ?? null;
      },
      create: async (args: any) => (calls.push({ method: "create", args }), { id: "new", ...args.data }),
      update: async (args: any) => (calls.push({ method: "update", args }), {}),
    },
  };
  return { db, calls };
}

const user = (overrides: Partial<UserRow>): UserRow => ({
  id: "u1", email: "john@example.com", password: bcrypt.hashSync("password123", 4), name: "John", image: null, role: "CUSTOMER", createdAt: new Date("2024-01-01"), ...overrides,
});

function loadAuthorize(rows: UserRow[]) {
  const { db, calls } = makeDb(rows);
  let config: any;
  const load = moduleLoader({
    "@/lib/db": { db },
    "next-auth": { __esModule: true, default: (input: unknown) => ((config = input), { handlers: {}, auth: () => null, signIn: () => null, signOut: () => null }) },
    "next-auth/providers/credentials": { __esModule: true, default: (input: any) => input },
    "next-auth/providers/google": { __esModule: true, default: (input: any) => input },
  });
  load("lib/auth.ts");
  const credentials = config.providers.find((provider: any) => provider.name === "Credentials");
  return { authorize: credentials.authorize as (input: unknown) => Promise<any>, calls };
}

test("credentials login finds a user regardless of email case and surrounding spaces", async () => {
  const { authorize } = loadAuthorize([user({})]);
  const result = await authorize({ email: "  John@Example.COM ", password: "password123" });
  assert.equal(result?.id, "u1");
  assert.equal(await authorize({ email: "John@Example.COM", password: "wrong-password" }), null);
});

test("credentials login prefers the exact-case row when legacy data has two rows differing by case", async () => {
  const legacy = user({ id: "legacy", email: "John@Example.com", password: bcrypt.hashSync("legacy-pass", 4), createdAt: new Date("2023-01-01") });
  const modern = user({ id: "modern", email: "john@example.com" });
  const { authorize } = loadAuthorize([legacy, modern]);
  assert.equal((await authorize({ email: "john@example.com", password: "password123" }))?.id, "modern");
  assert.equal((await authorize({ email: "John@Example.com", password: "legacy-pass" }))?.id, "legacy");
  // Typed in yet another case: the oldest case-insensitive match is used.
  assert.equal((await authorize({ email: "JOHN@example.com", password: "legacy-pass" }))?.id, "legacy");
});

function loadRegister(rows: UserRow[], createError?: unknown) {
  const { db, calls } = makeDb(rows);
  if (createError) db.user.create = async () => { throw createError; };
  const load = moduleLoader({
    "@/lib/db": { db },
    "@/lib/rate-limit": { checkRateLimit: async () => ({ success: true }) },
    "@/lib/request-identity": { getTrustedClientIdentifier: () => "ip" },
  });
  return { POST: load("app/api/auth/register/route.ts").POST as (request: unknown) => Promise<Response>, calls };
}

test("register stores a trimmed lowercase email and checks existence case-insensitively", async () => {
  const { POST, calls } = loadRegister([]);
  const response = await POST({ json: async () => ({ name: "Jane", email: "  Jane@Example.COM ", password: "password123" }) });
  assert.equal(response.status, 201);
  const check = calls.find((call) => call.method === "findFirst")!;
  assert.deepEqual(check.args.where.email, { equals: "jane@example.com", mode: "insensitive" });
  assert.equal(calls.find((call) => call.method === "create")!.args.data.email, "jane@example.com");
});

test("register rejects an email that exists with different case", async () => {
  const { POST, calls } = loadRegister([user({ email: "Jane@Example.com" })]);
  const response = await POST({ json: async () => ({ name: "Jane", email: "jane@example.com", password: "password123" }) });
  assert.equal(response.status, 400);
  assert.ok(!calls.some((call) => call.method === "create"));
});

test("register reports a lost unique-constraint race as already in use", async () => {
  const { POST } = loadRegister([], { code: "P2002" });
  const response = await POST({ json: async () => ({ name: "Jane", email: "jane@example.com", password: "password123" }) });
  assert.equal(response.status, 400);
});

test("forgot-password finds the account case-insensitively and mails the stored address", async () => {
  const { db, calls } = makeDb([user({ email: "John@Example.com" })]);
  const sentTo: string[] = [];
  const load = moduleLoader({
    "@/lib/db": { db },
    "@/lib/email": {
      getAppBaseUrl: () => "https://shop.example",
      sendPasswordResetEmail: async (to: string) => void sentTo.push(to),
    },
    "@/lib/rate-limit": { checkRateLimit: async () => ({ success: true }) },
    "@/lib/request-identity": { getTrustedClientIdentifier: () => "ip" },
  });
  // getStoreSettings reads db.storeSettings
  (db as any).storeSettings = { findFirst: async () => null };
  const { POST } = load("app/api/auth/forgot-password/route.ts");
  const response = await POST({ json: async () => ({ email: " JOHN@example.com " }) });
  assert.equal(response.status, 200);
  assert.deepEqual(sentTo, ["John@Example.com"]);
  assert.equal(calls.find((call) => call.method === "update")!.args.where.id, "u1");
});

test("forgot-password answers identically and sends nothing for unknown emails", async () => {
  const { db } = makeDb([]);
  const sentTo: string[] = [];
  const load = moduleLoader({
    "@/lib/db": { db },
    "@/lib/email": { getAppBaseUrl: () => "https://shop.example", sendPasswordResetEmail: async (to: string) => void sentTo.push(to) },
    "@/lib/rate-limit": { checkRateLimit: async () => ({ success: true }) },
    "@/lib/request-identity": { getTrustedClientIdentifier: () => "ip" },
  });
  const { POST } = load("app/api/auth/forgot-password/route.ts");
  assert.equal((await POST({ json: async () => ({ email: "nobody@example.com" }) })).status, 200);
  assert.equal(sentTo.length, 0);
});

test("ADMIN_EMAIL comparison is trimmed and case-insensitive", () => {
  const load = moduleLoader({});
  const { isAdminEmail, authConfig } = load("lib/auth.config.ts");
  const previous = process.env.ADMIN_EMAIL;
  process.env.ADMIN_EMAIL = "  Owner@Example.com ";
  try {
    assert.equal(isAdminEmail("owner@example.COM"), true);
    assert.equal(isAdminEmail(" OWNER@example.com "), true);
    assert.equal(isAdminEmail("other@example.com"), false);
    assert.equal(isAdminEmail(null), false);
    const token = authConfig.callbacks.jwt({ token: {}, user: { id: "1", email: "OWNER@example.com", role: "CUSTOMER" } });
    return Promise.resolve(token).then((result: any) => assert.equal(result.role, "ADMIN"));
  } finally {
    if (previous === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = previous;
  }
});

test("an unset ADMIN_EMAIL never grants admin", () => {
  const load = moduleLoader({});
  const { isAdminEmail } = load("lib/auth.config.ts");
  const previous = process.env.ADMIN_EMAIL;
  delete process.env.ADMIN_EMAIL;
  try {
    assert.equal(isAdminEmail("anyone@example.com"), false);
    assert.equal(isAdminEmail(""), false);
  } finally {
    if (previous !== undefined) process.env.ADMIN_EMAIL = previous;
  }
});
