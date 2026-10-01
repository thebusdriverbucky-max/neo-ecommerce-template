import assert from "node:assert/strict";
import test from "node:test";
import { moduleLoader } from "./helpers/load-module";

test("email import/send is lazy, email-off returns null without logging private data; client rotates keys", async () => {
  delete process.env.RESEND_API_KEY;
  let constructed = 0;
  let sent = 0;
  let fail = false;
  const load = moduleLoader({
    resend: { Resend: class {
      constructor(key: string) { assert.ok(key); constructed++; }
      emails = { send: async () => { sent++; return fail ? { error: { message: "sensitive" } } : { data: { id: "test-message" } }; } };
    } },
    "./email-templates": {},
  });
  const email = load("lib/email.ts");
  const payload = { to: "private@example.test", subject: "Private", html: "reset-token-secret" };
  const originalLog = console.log;
  const logs: unknown[] = [];
  console.log = (...values: unknown[]) => { logs.push(values); };
  try {
    assert.equal(constructed, 0);
    assert.equal(await email.sendEmail(payload), null);
    assert.equal(constructed, 0);
    assert.equal(sent, 0);
    assert.equal(logs.length, 0);
    process.env.RESEND_API_KEY = "isolated-key";
    assert.deepEqual(await email.sendEmail(payload), { id: "test-message" });
    await email.sendEmail(payload);
    assert.equal(constructed, 1);
    process.env.RESEND_API_KEY = "rotated-isolated-key";
    await email.sendEmail(payload);
    assert.equal(constructed, 2);
    fail = true;
    assert.equal(await email.sendEmail(payload), null);
  } finally { console.log = originalLog; delete process.env.RESEND_API_KEY; }
});

test("optional Redis does not initialize with absent/partial credentials", () => {
  let constructed = 0;
  const loadRedis = () => moduleLoader({ "@upstash/redis": { Redis: class { constructor() { constructed++; } } } })("lib/redis.ts");
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  assert.equal(loadRedis().redis, null);
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.test";
  assert.equal(loadRedis().redis, null);
  assert.equal(constructed, 0);
});

test("local limiter enforces independent limits; configured Redis outage and partial config fail closed", async () => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  let constructed = 0;
  const load = moduleLoader({
    "./redis": { redis: {} },
    "@upstash/ratelimit": { Ratelimit: class {
      static slidingWindow() { return {}; }
      constructor() { constructed++; }
      async limit() { throw new Error("Offline"); }
    } },
    "./logger": { logger: { error() {} } },
  });
  const { checkRateLimit } = load("lib/rate-limit.ts");
  for (let i = 0; i < 5; i++) assert.equal((await checkRateLimit("a", "auth")).success, true);
  assert.equal((await checkRateLimit("a", "auth")).success, false);
  assert.equal((await checkRateLimit("b", "auth")).success, true);
  assert.equal((await checkRateLimit("a", "contact")).success, true);
  assert.equal(constructed, 0);
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.test";
  assert.equal((await checkRateLimit("a", "auth")).unavailable, true);
  process.env.UPSTASH_REDIS_REST_TOKEN = "isolated-token";
  assert.equal((await checkRateLimit("a", "auth")).success, false);
  assert.equal(constructed, 1);
});

test("request identity ignores spoofable forwarding headers outside trusted Vercel deployment", () => {
  const { getTrustedClientIdentifier } = moduleLoader({})("lib/request-identity.ts");
  const request = new Request("https://store.example.test", { headers: { "x-forwarded-for": "1.2.3.4", "x-real-ip": "2.3.4.5", "x-vercel-forwarded-for": "3.4.5.6" } });
  delete process.env.VERCEL;
  assert.equal(getTrustedClientIdentifier(request), "anonymous");
  process.env.VERCEL = "1";
  assert.equal(getTrustedClientIdentifier(request), "3.4.5.6");
});
