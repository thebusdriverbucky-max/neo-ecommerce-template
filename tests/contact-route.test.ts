import assert from "node:assert/strict";
import test from "node:test";
import { moduleLoader } from "./helpers/load-module";

type Sent = { to: string; subject: string; html: string; replyTo?: string };

function loadRoute(settings: unknown = { storeName: "Shop", storeEmail: "owner@example.com" }) {
  const sent: Sent[] = [];
  const load = moduleLoader({
    "@/lib/email": { sendEmail: async (payload: Sent) => (sent.push(payload), { id: "1" }) },
    "@/lib/db": { db: { storeSettings: { findFirst: async () => settings } } },
    "@/lib/rate-limit": { checkRateLimit: async () => ({ success: true }) },
    "@/lib/request-identity": { getTrustedClientIdentifier: () => "ip" },
  });
  return { POST: load("app/api/contact/route.ts").POST as (request: unknown) => Promise<Response>, sent };
}

const request = (body: unknown) => ({ json: async () => body });
const valid = {
  name: "Mallory",
  email: "visitor@example.com",
  subject: "Question about my order",
  message: "Hello, I have a question about my order please.",
};

test("contact form emails only the store owner, with reply-to, and sends no auto-reply", async () => {
  const { POST, sent } = loadRoute();
  const response = await POST(request(valid));
  assert.equal(response.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "owner@example.com");
  assert.equal(sent[0].replyTo, "visitor@example.com");
  assert.ok(!sent.some((message) => message.to === valid.email), "the submitter is never emailed");
});

test("contact form falls back to ADMIN_EMAIL when the settings have no store email", async () => {
  const { POST, sent } = loadRoute({ storeName: "Shop", storeEmail: null });
  const previous = process.env.ADMIN_EMAIL;
  process.env.ADMIN_EMAIL = "admin@example.com";
  try {
    assert.equal((await POST(request(valid))).status, 200);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = previous;
  }
  assert.equal(sent[0].to, "admin@example.com");
});

test("contact form escapes every field and keeps the subject on one line", async () => {
  const { POST, sent } = loadRoute();
  const html = '<a href="https://evil.example">Click</a>';
  const response = await POST(request({
    name: `Eve ${html}`,
    email: "visitor@example.com",
    subject: `Hello ${html}`,
    message: `Please ${html} <script>alert(1)</script>`,
  }));
  assert.equal(response.status, 200);
  assert.ok(!sent[0].html.includes(html));
  assert.ok(!sent[0].html.includes("<script>"));
  assert.match(sent[0].html, /&lt;a href=&quot;https:\/\/evil\.example&quot;&gt;Click&lt;\/a&gt;/);
  assert.ok(!/[\r\n]/.test(sent[0].subject));
});

test("contact form honeypot returns success without sending anything", async () => {
  const { POST, sent } = loadRoute();
  const response = await POST(request({ ...valid, website: "http://spam.example" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, message: "Message sent successfully" });
  assert.equal(sent.length, 0);
});

test("contact form rejects invalid input and mails nothing", async () => {
  const { POST, sent } = loadRoute();
  assert.equal((await POST(request({ ...valid, email: "not-an-email" }))).status, 400);
  assert.equal((await POST(request({ ...valid, message: "short" }))).status, 400);
  assert.equal(sent.length, 0);
});
