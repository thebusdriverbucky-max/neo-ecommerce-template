import assert from "node:assert/strict";
import test from "node:test";
import { moduleLoader } from "./helpers/load-module";

function loadJwt(findUnique: (args: any) => Promise<any>) {
  const queries: any[] = [];
  let config: any;
  const load = moduleLoader({
    "@/lib/db": { db: { user: { findUnique: async (args: any) => (queries.push(args), findUnique(args)) } } },
    "next-auth": { __esModule: true, default: (input: unknown) => ((config = input), { handlers: {}, auth: () => null, signIn: () => null, signOut: () => null }) },
    "next-auth/providers/credentials": { __esModule: true, default: (input: any) => input },
    "next-auth/providers/google": { __esModule: true, default: (input: any) => input },
  });
  load("lib/auth.ts");
  const jwt = config.callbacks.jwt as (params: any) => Promise<any>;
  return { jwt, queries };
}

async function withAdminEmail<T>(value: string | undefined, run: () => Promise<T>) {
  const previous = process.env.ADMIN_EMAIL;
  if (value === undefined) delete process.env.ADMIN_EMAIL;
  else process.env.ADMIN_EMAIL = value;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = previous;
  }
}

test("customer tokens never cause a database query", async () => {
  const { jwt, queries } = loadJwt(async () => {
    throw new Error("must not be called");
  });
  const token = await jwt({ token: { id: "u1", role: "CUSTOMER" } });
  assert.equal(token.role, "CUSTOMER");
  assert.equal(queries.length, 0);
});

test("an admin whose database role is still ADMIN keeps access", async () => {
  const { jwt, queries } = loadJwt(async () => ({ id: "u1", email: "a@example.com", role: "ADMIN" }));
  const token = await withAdminEmail("someone-else@example.com", () => jwt({ token: { id: "u1", role: "ADMIN" } }));
  assert.equal(token.role, "ADMIN");
  assert.deepEqual(queries[0], { where: { id: "u1" }, select: { id: true, email: true, role: true } });
});

test("an admin whose role was revoked and email no longer matches ADMIN_EMAIL is downgraded", async () => {
  const { jwt } = loadJwt(async () => ({ id: "u1", email: "hijacker@example.com", role: "CUSTOMER" }));
  const token = await withAdminEmail("owner@example.com", () => jwt({ token: { id: "u1", role: "ADMIN" } }));
  assert.equal(token.role, "CUSTOMER");
});

test("the ADMIN_EMAIL account stays admin even when its database role is CUSTOMER (case-insensitive)", async () => {
  const { jwt } = loadJwt(async () => ({ id: "u1", email: "Owner@Example.com", role: "CUSTOMER" }));
  const token = await withAdminEmail(" owner@example.com ", () => jwt({ token: { id: "u1", role: "ADMIN" } }));
  assert.equal(token.role, "ADMIN");
});

test("a deleted admin user ends the session", async () => {
  const { jwt } = loadJwt(async () => null);
  assert.equal(await jwt({ token: { id: "gone", role: "ADMIN" } }), null);
});

test("a database error downgrades the admin for this request instead of throwing", async () => {
  const { jwt } = loadJwt(async () => {
    throw new Error("connection refused");
  });
  const token = await jwt({ token: { id: "u1", role: "ADMIN" } });
  assert.equal(token.role, "CUSTOMER");
});

test("a transient database error does not permanently demote a legitimate admin", async () => {
  let fail = true;
  const { jwt } = loadJwt(async () => {
    if (fail) throw new Error("connection refused");
    return { id: "u1", email: "a@example.com", role: "ADMIN" };
  });
  const degraded = await withAdminEmail("owner@example.com", () => jwt({ token: { id: "u1", role: "ADMIN" } }));
  assert.equal(degraded.role, "CUSTOMER");
  assert.equal(degraded.adminRecheck, true);

  fail = false;
  const restored = await withAdminEmail("owner@example.com", () => jwt({ token: degraded }));
  assert.equal(restored.role, "ADMIN");
  assert.equal("adminRecheck" in restored, false);
});

test("a recheck never promotes a user the database does not confirm as admin", async () => {
  const { jwt } = loadJwt(async () => ({ id: "u1", email: "hijacker@example.com", role: "CUSTOMER" }));
  const token = await withAdminEmail("owner@example.com", () =>
    jwt({ token: { id: "u1", role: "CUSTOMER", adminRecheck: true } }),
  );
  assert.equal(token.role, "CUSTOMER");
  assert.equal("adminRecheck" in token, false);
});

test("a token without a user id cannot stay admin", async () => {
  const { jwt, queries } = loadJwt(async () => ({ id: "u1", email: "a@example.com", role: "ADMIN" }));
  const token = await jwt({ token: { role: "ADMIN" } });
  assert.equal(token.role, "CUSTOMER");
  assert.equal(queries.length, 0);
});

test("signing in with the ADMIN_EMAIL address yields an admin token that is then verified", async () => {
  const { jwt, queries } = loadJwt(async () => ({ id: "u1", email: "owner@example.com", role: "CUSTOMER" }));
  const token = await withAdminEmail("OWNER@example.com", () =>
    jwt({ token: {}, user: { id: "u1", email: "owner@example.com", role: "CUSTOMER" } }),
  );
  assert.equal(token.role, "ADMIN");
  assert.equal(queries.length, 1);
});
