import assert from "node:assert/strict";
import test from "node:test";
import { moduleLoader } from "./helpers/load-module";

const ENV_KEYS = ["RESEND_API_KEY", "ADMIN_EMAIL"];

const request = (body: unknown) => new Request("https://store.example.test/api/contact", { method: "POST", body: JSON.stringify(body) });

function setup(options: { storeEmail?: string | null; storeName?: string; delivered?: unknown; rateLimit?: any } = {}) {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.ADMIN_EMAIL = "owner@example.test";
  const messages: any[] = [];
  const load = moduleLoader({
    "@/lib/rate-limit": { checkRateLimit: async () => options.rateLimit ?? { success: true } },
    "@/lib/email": { sendEmail: async (payload: any) => { messages.push(payload); return "delivered" in options ? options.delivered : { id: "mail-1" }; } },
    "@/lib/db": { db: { storeSettings: { findFirst: async () => ({ storeName: options.storeName ?? "Acme", storeEmail: options.storeEmail ?? null }) } } },
  });
  const restore = () => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  };
  return { POST: load("app/api/contact/route.ts").POST, messages, restore };
}

const valid = { name: "Visitor", email: "visitor@example.test", subject: "Question about sizing", message: "Do you restock the blue widget soon?" };

test("contact notifies only the store owner, sets reply-to and never auto-replies to the submitter", async () => {
  const { POST, messages, restore } = setup({ storeEmail: "help@acme.test" });
  try {
    const response = await POST(request(valid));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, message: "Message sent successfully" });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].to, "help@acme.test");
    assert.equal(messages[0].replyTo, "visitor@example.test");
    assert.equal(messages[0].subject, "New Contact: Question about sizing");
    assert.match(messages[0].html, /ACME/);
    assert.ok(messages.every((message) => message.to !== valid.email));
  } finally { restore(); }
});

test("contact falls back to ADMIN_EMAIL and returns 503 when mail is unconfigured or undelivered", async () => {
  const fallback = setup({ storeEmail: null });
  try {
    assert.equal((await fallback.POST(request(valid))).status, 200);
    assert.equal(fallback.messages[0].to, "owner@example.test");
    delete process.env.ADMIN_EMAIL;
    assert.equal((await fallback.POST(request(valid))).status, 503);
    process.env.ADMIN_EMAIL = "owner@example.test";
    delete process.env.RESEND_API_KEY;
    assert.equal((await fallback.POST(request(valid))).status, 503);
    assert.equal(fallback.messages.length, 1);
  } finally { fallback.restore(); }

  const failing = setup({ delivered: null });
  try {
    assert.equal((await failing.POST(request(valid))).status, 503);
  } finally { failing.restore(); }

  const limited = setup({ rateLimit: { success: false } });
  try {
    assert.equal((await limited.POST(request(valid))).status, 429);
    assert.equal(limited.messages.length, 0);
  } finally { limited.restore(); }
});

test("contact honeypot silently succeeds without sending anything", async () => {
  const { POST, messages, restore } = setup();
  try {
    const response = await POST(request({ ...valid, website: "https://spam.example.test" }));
    assert.equal(response.status, 200);
    assert.equal(messages.length, 0);
    assert.equal((await POST(request({ ...valid, website: "" }))).status, 200);
    assert.equal(messages.length, 1);
  } finally { restore(); }
});

test("contact caps field lengths, sanitizes the subject and escapes the HTML", async () => {
  const { POST, messages, restore } = setup({ storeName: "<script>store</script>" });
  try {
    for (const bad of [
      { ...valid, name: "x".repeat(101) },
      { ...valid, email: `${"a".repeat(250)}@example.test` },
      { ...valid, subject: "s".repeat(201) },
      { ...valid, message: "m".repeat(2001) },
      { ...valid, email: "not-an-email" },
    ]) assert.equal((await POST(request(bad))).status, 400);
    assert.equal(messages.length, 0);

    const response = await POST(request({
      name: "<b>Eve</b>",
      email: "eve@example.test",
      subject: "Hello\r\nBcc: victim@example.test",
      message: "<img src=x onerror=alert(1)> and <script>alert(2)</script>",
    }));
    assert.equal(response.status, 200);
    const [message] = messages;
    assert.doesNotMatch(message.subject, /[\r\n]/);
    assert.doesNotMatch(message.html, /<img|<script|<b>Eve/);
    assert.match(message.html, /&lt;img/);
    assert.match(message.html, /&lt;SCRIPT&gt;STORE/);
  } finally { restore(); }
});
