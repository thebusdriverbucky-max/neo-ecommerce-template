import assert from "node:assert/strict";
import test from "node:test";
import { moduleLoader } from "./helpers/load-module";

const request = (body: unknown) => new Request("https://store.example.test/api/test", { method: "POST", body: JSON.stringify(body) });

test("common endpoints reject malformed input before DB/provider operations and return 503 for limiter outages", async () => {
  let success = true;
  const load = moduleLoader({
    "@/lib/db": { db: new Proxy({}, { get() { throw new Error("Unexpected database access"); } }) },
    "@/lib/auth": { auth: async () => ({ user: { id: "user-1", role: "ADMIN" } }) },
    "@/lib/email": { sendEmail: async () => { throw new Error("Unexpected email"); }, sendPasswordResetEmail: async () => { throw new Error("Unexpected email"); } },
    "@/lib/rate-limit": { checkRateLimit: async () => ({ success, unavailable: !success }) },
    "next/cache": { revalidatePath() {} },
  });
  const cases: [string, unknown][] = [
    ["auth/register", { name: "A", email: "bad", password: "short" }],
    ["auth/forgot-password", { email: "bad" }],
    ["auth/reset-password", { token: "bad", password: "password123" }],
    ["contact", { name: "  ", email: "bad" }],
    ["coupons/validate", { code: {}, orderAmount: -1 }],
    ["discounts/validate", { code: [] }],
    ["wishlist", { productId: {} }],
    ["products/[id]/reviews", { rating: 6, comment: "review" }],
  ];
  for (const [route, body] of cases) {
    const handler = load(`app/api/${route}/route.ts`).POST;
    assert.equal((await handler(request(body), { params: { id: "product-1" } })).status, 400, route);
    const malformed = new Request("https://store.example.test/api/test", { method: "POST", body: "{" });
    assert.equal((await handler(malformed, { params: { id: "product-1" } })).status, 400, route);
    success = false;
    assert.equal((await handler(request(body), { params: { id: "product-1" } })).status, 503, route);
    success = true;
  }
  assert.equal((await load("app/api/discounts/route.ts").POST(request({ code: "SALE", type: "PERCENT", value: 101 }))).status, 400);
});

test("contact does not claim delivery in email-off/error modes and escapes submitted HTML", async () => {
  let delivered: any = null;
  const messages: any[] = [];
  const load = moduleLoader({
    "@/lib/rate-limit": { checkRateLimit: async () => ({ success: true }) },
    "@/lib/email": { sendEmail: async (payload: any) => { messages.push(payload); return delivered; } },
  });
  const body = { name: "<b>Person</b>", email: "person@example.test", subject: "<script>subject</script>", message: "<img src=x onerror=alert(1)>" };
  const { POST } = load("app/api/contact/route.ts");
  process.env.ADMIN_EMAIL = "admin@example.test";
  delete process.env.RESEND_API_KEY;
  assert.equal((await POST(request(body))).status, 503);
  assert.equal(messages.length, 0);
  process.env.RESEND_API_KEY = "isolated-key";
  assert.equal((await POST(request(body))).status, 503);
  delivered = { id: "test-id" };
  assert.equal((await POST(request(body))).status, 200);
  assert.ok(messages.every(message => !/<script>|<img|<b>Person/.test(message.html)));
  assert.match(messages[0].html, /&lt;img/);
});

test("forgot password email-off does not query or mutate database", async () => {
  delete process.env.RESEND_API_KEY;
  const load = moduleLoader({
    "@/lib/db": { db: new Proxy({}, { get() { throw new Error("Unexpected DB access"); } }) },
    "@/lib/rate-limit": { checkRateLimit: async () => ({ success: true }) },
    "@/lib/email": { sendPasswordResetEmail: async () => { throw new Error("Unexpected email"); } },
  });
  assert.equal((await load("app/api/auth/forgot-password/route.ts").POST(request({ email: "owner@example.test" }))).status, 200);
});

test("reset password stores no raw token and compare-and-clear permits only one concurrent reset", async () => {
  const raw = "a".repeat(64);
  let consumed = false;
  const load = moduleLoader({
    "@/lib/rate-limit": { checkRateLimit: async () => ({ success: true }) },
    "bcryptjs": { hash: async () => "password-hash" },
    "@/lib/db": { db: { user: {
      findFirst: async ({ where }: any) => { assert.notEqual(where.resetToken, raw); return { id: "user-1" }; },
      updateMany: async ({ where, data }: any) => {
        assert.notEqual(where.resetToken, raw);
        assert.ok(where.resetTokenExpiry.gt instanceof Date);
        assert.equal(data.resetToken, null);
        if (consumed) return { count: 0 };
        consumed = true;
        return { count: 1 };
      },
    } } },
  });
  const { POST } = load("app/api/auth/reset-password/route.ts");
  const responses = await Promise.all([POST(request({ token: raw, password: "password123" })), POST(request({ token: raw, password: "password123" }))]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 400]);
});
