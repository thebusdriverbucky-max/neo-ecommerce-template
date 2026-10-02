import assert from "node:assert/strict";
import test from "node:test";
import * as jose from "jose";
import { NextRequest } from "next/server";
import { moduleLoader } from "./helpers/load-module";

const secret = "isolated-test-secret-not-a-production-secret";
const product = "issued-test-product";
const key = "issued-test-key";
function setup() {
  process.env.LICENSE_SERVER_SECRET = secret;
  process.env.LICENSE_PRODUCT = product;
  process.env.LICENSE_KEY = key;
  process.env.LICENSE_SERVER_URL = "https://license.example.test";
  return moduleLoader({ jose })("lib/license.ts");
}
async function signed(claims: Record<string, unknown> = {}, expires: string | null = "1h", signingSecret = secret) {
  let jwt = new jose.SignJWT({ valid: true, product, key, ...claims }).setProtectedHeader({ alg: "HS256" });
  if (expires) jwt = jwt.setExpirationTime(expires);
  return jwt.sign(new TextEncoder().encode(signingSecret));
}

test("license tokens require signature, expiry, valid=true and exact product/key binding", async () => {
  const license = setup();
  assert.equal(await license.verifyLicenseToken(await signed()), true);
  for (const token of ["grace", "invalid", await signed({ valid: false }), await signed({ valid: "true" }),
    await signed({ product: "another-product" }), await signed({ key: "another-key" }),
    await signed({ key: undefined }), await signed({}, "-1s"), await signed({}, null), await signed({}, "1h", "wrong-secret")]) {
    assert.equal(await license.verifyLicenseToken(token), false);
  }
});

test("license configuration has no product/secret defaults and never calls server when incomplete", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("Network forbidden"); };
  try {
    for (const name of ["LICENSE_SERVER_SECRET", "LICENSE_PRODUCT", "LICENSE_KEY", "LICENSE_SERVER_URL"]) {
      const license = setup();
      delete process.env[name];
      assert.deepEqual(await license.fetchLicenseValidation(), { valid: false });
      if (name !== "LICENSE_SERVER_URL") assert.equal(await license.verifyLicenseToken(await signed()), false);
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test("license validation rejects outages, 4xx, malformed data, missing token and forged binding", async () => {
  const license = setup();
  const original = globalThis.fetch;
  try {
    const responses = [
      async () => { throw new Error("Offline"); },
      async () => new Response("down", { status: 503 }),
      async () => Response.json({ valid: true }, { status: 403 }),
      async () => new Response("not JSON"),
      async () => Response.json({ valid: true, product }),
      async () => Response.json({ valid: true, product, token: await signed({ key: "other" }) }),
      async () => Response.json({ valid: true, product: "other", token: await signed() }),
    ];
    for (const response of responses) {
      globalThis.fetch = response;
      assert.deepEqual(await license.fetchLicenseValidation(), { valid: false });
    }
    const token = await signed();
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://license.example.test/api/validate");
      assert.deepEqual(JSON.parse(options!.body as string), { key, product });
      assert.equal(options!.redirect, "error");
      return Response.json({ valid: true, product, token, grace: true });
    };
    assert.deepEqual(await license.fetchLicenseValidation(), { valid: true, product, token });
    process.env.LICENSE_SERVER_URL = "http://license.example.test";
    assert.deepEqual(await license.fetchLicenseValidation(), { valid: false });
  } finally { globalThis.fetch = original; }
});

test("middleware blocks grace/missing proof and retains authentication checks after license validation", async () => {
  let validation: any = { valid: false };
  let fetches = 0;
  let authCalls = 0;
  const load = moduleLoader({
    "next-auth": () => ({ auth: async () => { authCalls++; return undefined; } }),
    "@/lib/license": {
      LICENSE_COOKIE_NAME: "neo_license",
      verifyLicenseToken: async (token: string) => token === "verified-token",
      fetchLicenseValidation: async () => { fetches++; return validation; },
    },
  });
  const middleware = load("middleware.ts").default;
  const request = (path: string, cookie = "") => new NextRequest(`https://store.example.test${path}`, { headers: { cookie } });
  let response = await middleware(request("/admin", "neo_license=grace"));
  assert.equal(response.status, 307);
  assert.match(response.headers.get("location"), /license-required/);
  assert.equal(authCalls, 0);
  validation = { valid: true, grace: true };
  assert.equal((await middleware(request("/admin"))).status, 307);
  assert.equal(authCalls, 0);
  validation = { valid: true, token: "verified-token" };
  response = await middleware(request("/admin"));
  assert.equal(response.cookies.get("neo_license").value, "verified-token");
  assert.equal(authCalls, 1);
  const before = fetches;
  await middleware(request("/admin", "neo_license=verified-token"));
  assert.equal(fetches, before);
  assert.equal(authCalls, 2);
  validation = { valid: false };
  assert.equal((await middleware(request("/api/auth-not-a-system-path"))).status, 307);
  await middleware(request("/api/auth/providers"));
  assert.equal(authCalls, 3);
});

test("middleware preserves a newly issued license cookie when authentication returns no response", async () => {
  let validations = 0;
  const load = moduleLoader({
    "next-auth": () => ({ auth: async () => undefined }),
    "@/lib/license": {
      LICENSE_COOKIE_NAME: "neo_license",
      verifyLicenseToken: async (token: string) => token === "verified-token",
      fetchLicenseValidation: async () => {
        validations++;
        return { valid: true, token: "verified-token" };
      },
    },
  });
  const middleware = load("middleware.ts").default;
  const request = new NextRequest("https://store.example.test/");

  const response = await middleware(request);

  assert.equal(response.status, 200);
  assert.equal(response.cookies.get("neo_license")?.value, "verified-token");
  assert.equal(validations, 1);
});
