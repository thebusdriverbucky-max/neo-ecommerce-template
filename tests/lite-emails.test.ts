import assert from "node:assert/strict";
import test from "node:test";
import { moduleLoader } from "./helpers/load-module";

const SECRET = "g".repeat(40);
const ENV_KEYS = ["RESEND_API_KEY", "ADMIN_EMAIL", "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_STORE_URL", "NEXT_PUBLIC_SITE_URL", "GUEST_ORDER_TOKEN_SECRET", "NEXT_PUBLIC_STORE_NAME", "STORE_SUPPORT_EMAIL", "NEXT_PUBLIC_CURRENCY_SYMBOL"];

type Sent = { to: string; subject: string; html: string; replyTo?: string };

function setup(options: { failSend?: boolean } = {}) {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.NEXT_PUBLIC_APP_URL = "https://shop.example.test/";
  process.env.GUEST_ORDER_TOKEN_SECRET = SECRET;

  const sent: Sent[] = [];
  const logs: string[] = [];
  const originals = { log: console.log, warn: console.warn, error: console.error };
  const capture = (...values: unknown[]) => { logs.push(values.map(String).join(" ")); };
  console.log = capture; console.warn = capture; console.error = capture;

  const load = moduleLoader({
    resend: { Resend: class {
      emails = { send: async (payload: any) => {
        if (options.failSend) throw new Error(`network down for ${payload.to}`);
        sent.push({ to: payload.to, subject: payload.subject, html: payload.html, replyTo: payload.replyTo });
        return { data: { id: "mail-1" } };
      } };
    } },
    "@/lib/db": { db: {} },
  });
  const restore = () => {
    Object.assign(console, originals);
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  };
  return { load, sent, logs, restore };
}

const settings = (overrides: Record<string, unknown> = {}) => ({ storeName: "Acme <Shop>", storeEmail: "help@acme.test", currency: "EUR", ...overrides }) as any;

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    orderNumber: "#2030-0042",
    userId: "user-1",
    guestEmail: null,
    user: { email: "buyer@example.test" },
    currency: "EUR",
    subtotal: "100.00",
    discountAmount: "10.00",
    discountCode: "SAVE10",
    shippingCost: "5.00",
    tax: "9.45",
    total: "104.45",
    paymentIban: "DE89 3704 0044 0532 0130 00",
    paymentBankName: "Acme Bank",
    paymentAccountName: "Acme Ltd",
    paymentDetails: "Use the order number as reference",
    status: "PENDING",
    trackingNumber: null,
    items: [
      { quantity: 2, price: "30.00", product: { name: "Widget" } },
      { quantity: 1, price: "40.00", product: { name: "Gadget" } },
    ],
    shippingAddress: { firstName: "Ann", lastName: "Lee", street: "1 Main St", city: "Berlin", state: "BE", postalCode: "10115", country: "DE", phone: null },
    ...overrides,
  } as any;
}

test("order received email carries the bank snapshot, reservation period and a reconciling price breakdown", async () => {
  const { load, sent, restore } = setup();
  try {
    const { sendOrderPlacedEmails } = load("lib/email.ts");
    await sendOrderPlacedEmails(order(), settings());
    const customer = sent.find((message) => message.to === "buyer@example.test")!;
    assert.equal(customer.subject, "Order received #2030-0042 — bank transfer required");
    assert.match(customer.html, /bank transfer required/i);
    assert.match(customer.html, /DE89 3704 0044 0532 0130 00/);
    assert.match(customer.html, /Acme Bank/);
    assert.match(customer.html, /Acme Ltd/);
    assert.match(customer.html, /reserved for 7 days/);
    assert.match(customer.html, /transfer exactly/i);
    assert.match(customer.html, /payment reference/i);
    assert.match(customer.html, /#2030-0042/);
    // Rows add up: 100.00 - 10.00 + 5.00 + 9.45 = 104.45, with line totals.
    for (const amount of ["60,00", "40,00", "100,00", "10,00", "5,00", "9,45", "104,45"]) {
      assert.ok(customer.html.includes(amount) || customer.html.includes(amount.replace(",", ".")), amount);
    }
    assert.match(customer.html, /Discount \(SAVE10\)/);
    assert.match(customer.html, /€/);
    assert.doesNotMatch(customer.html, /\$|null|undefined|support@example\.com/);
    assert.match(customer.html, /help@acme\.test/);
  } finally { restore(); }
});

test("order emails escape every interpolated value and sanitize subjects", async () => {
  const { load, sent, restore } = setup();
  try {
    const { sendOrderPlacedEmails } = load("lib/email.ts");
    const hostile = '<img src=x onerror=alert(1)>';
    await sendOrderPlacedEmails(order({
      orderNumber: `#1\r\nBcc: evil@example.test`,
      discountCode: hostile,
      paymentIban: `<b>IBAN</b>`,
      paymentBankName: hostile,
      paymentAccountName: hostile,
      paymentDetails: `<script>details</script>`,
      items: [{ quantity: 1, price: "10.00", product: { name: hostile } }],
      shippingAddress: { firstName: hostile, lastName: "<i>x</i>", street: hostile, city: hostile, state: hostile, postalCode: hostile, country: hostile, phone: hostile },
    }), settings({ storeName: "<script>store</script>", storeEmail: `"><script>x</script>@acme.test` }));
    assert.equal(sent.length, 2);
    for (const message of sent) {
      assert.doesNotMatch(message.html, /<img|<script|<b>IBAN|<i>x/);
      assert.doesNotMatch(message.subject, /[\r\n]/);
    }
    assert.match(sent[0].html, /&lt;img/);
  } finally { restore(); }
});

test("missing bank fields are hidden and a missing IBAN falls back to the owner's instructions", async () => {
  const { load, sent, restore } = setup();
  try {
    const { sendOrderPlacedEmails } = load("lib/email.ts");
    await sendOrderPlacedEmails(order({ paymentBankName: null, paymentAccountName: "  ", paymentDetails: null }), settings());
    const partial = sent[0].html;
    assert.match(partial, /IBAN:/);
    assert.doesNotMatch(partial, /Bank:|Account name:|null/);

    sent.length = 0;
    await sendOrderPlacedEmails(order({ paymentIban: null, paymentBankName: "Ghost Bank", paymentDetails: "Pay via PayPal: owner@acme.test" }), settings());
    assert.match(sent[0].html, /Pay via PayPal: owner@acme\.test/);
    assert.doesNotMatch(sent[0].html, /IBAN:|Ghost Bank/);

    sent.length = 0;
    await sendOrderPlacedEmails(order({ paymentIban: "", paymentDetails: null }), settings());
    assert.match(sent[0].html, /payment instructions shortly/i);
  } finally { restore(); }
});

test("store name, support line and admin recipient come from settings, not env", async () => {
  const { load, sent, logs, restore } = setup();
  try {
    process.env.NEXT_PUBLIC_STORE_NAME = "Env Store";
    process.env.STORE_SUPPORT_EMAIL = "env-support@example.test";
    process.env.NEXT_PUBLIC_CURRENCY_SYMBOL = "£";
    const { sendOrderPlacedEmails } = load("lib/email.ts");

    await sendOrderPlacedEmails(order(), settings({ storeName: "Acme", storeEmail: "help@acme.test" }));
    assert.deepEqual(sent.map((message) => message.to), ["buyer@example.test", "help@acme.test"]);
    assert.match(sent[0].html, /ACME/);
    assert.doesNotMatch(sent[0].html, /Env Store|env-support|£/i);

    // No store email: admin mail falls back to ADMIN_EMAIL and customers see no support line.
    sent.length = 0;
    process.env.ADMIN_EMAIL = "owner@acme.test";
    await sendOrderPlacedEmails(order(), settings({ storeEmail: null }));
    assert.deepEqual(sent.map((message) => message.to), ["buyer@example.test", "owner@acme.test"]);
    assert.doesNotMatch(sent[0].html, /Questions\?|mailto:|owner@acme\.test|support@example\.com/);

    // No recipient at all: customer mail still goes out, the admin skip is logged.
    sent.length = 0; logs.length = 0;
    delete process.env.ADMIN_EMAIL;
    await sendOrderPlacedEmails(order(), settings({ storeEmail: null }));
    assert.deepEqual(sent.map((message) => message.to), ["buyer@example.test"]);
    assert.ok(logs.some((line) => /No store email or ADMIN_EMAIL/.test(line)));
    assert.ok(!logs.some((line) => /buyer@example\.test/.test(line)));

    // Settings missing entirely still produces a safe default.
    sent.length = 0;
    await sendOrderPlacedEmails(order(), null);
    assert.match(sent[0].html, /STORE/);
  } finally { restore(); }
});

test("admin notification lists items, totals, customer email and shipping address; guest email is used for guests", async () => {
  const { load, sent, restore } = setup();
  try {
    const { sendOrderPlacedEmails } = load("lib/email.ts");
    await sendOrderPlacedEmails(order({ userId: null, user: null, guestEmail: "guest@example.test" }), settings());
    assert.deepEqual(sent.map((message) => message.to), ["guest@example.test", "help@acme.test"]);
    const admin = sent[1];
    assert.equal(admin.subject, "New order #2030-0042 — awaiting bank transfer");
    assert.match(admin.html, /awaiting bank transfer/i);
    assert.match(admin.html, /guest@example\.test/);
    assert.match(admin.html, /Widget/);
    assert.match(admin.html, /Gadget/);
    assert.match(admin.html, /104[.,]45/);
    assert.match(admin.html, /1 Main St/);
    assert.match(admin.html, /Berlin/);
  } finally { restore(); }
});

test("order links: user orders are plain, guest orders are signed, and the link is omitted when unavailable", async () => {
  const { load, sent, restore } = setup();
  try {
    const { sendOrderPlacedEmails } = load("lib/email.ts");
    const { verifyGuestOrderToken } = load("lib/guest-order-token.ts");

    await sendOrderPlacedEmails(order({ id: "o/1" }), settings());
    assert.match(sent[0].html, /href="https:\/\/shop\.example\.test\/orders\/o%2F1"/);

    sent.length = 0;
    const guest = order({ id: "guest-order-1", userId: null, user: null, guestEmail: "guest@example.test" });
    await sendOrderPlacedEmails(guest, settings());
    const href = /href="(https:\/\/shop\.example\.test\/orders\/guest-order-1\?token=[^"]+)"/.exec(sent[0].html);
    assert.ok(href, "guest link carries a token");
    const token = decodeURIComponent(new URL(href![1].replace(/&amp;/g, "&")).searchParams.get("token")!);
    assert.equal(verifyGuestOrderToken(token, "guest-order-1"), true);
    assert.equal(verifyGuestOrderToken(token, "another-order"), false);

    sent.length = 0;
    delete process.env.GUEST_ORDER_TOKEN_SECRET;
    await sendOrderPlacedEmails(guest, settings());
    assert.doesNotMatch(sent[0].html, /\/orders\//);

    sent.length = 0;
    process.env.GUEST_ORDER_TOKEN_SECRET = "short";
    await sendOrderPlacedEmails(guest, settings());
    assert.doesNotMatch(sent[0].html, /\/orders\//);

    sent.length = 0;
    process.env.GUEST_ORDER_TOKEN_SECRET = SECRET;
    delete process.env.NEXT_PUBLIC_APP_URL;
    await sendOrderPlacedEmails(order(), settings());
    assert.doesNotMatch(sent[0].html, /\/orders\//);
  } finally { restore(); }
});

test("status emails use per-status wording, the full order number and the tracking number", async () => {
  const { load, sent, restore } = setup();
  try {
    const { sendOrderStatusEmail } = load("lib/email.ts");
    const expectations: [string, RegExp][] = [
      ["CONFIRMED", /received your payment/i],
      ["PROCESSING", /being prepared/i],
      ["SHIPPED", /has been shipped/i],
      ["DELIVERED", /has been delivered/i],
      ["CANCELLED", /unpaid order was cancelled.*released/i],
      ["REFUNDED", /has been refunded/i],
    ];
    for (const [status, pattern] of expectations) {
      sent.length = 0;
      await sendOrderStatusEmail("buyer@example.test", { id: "abcdef123456", orderNumber: "#2030-0042", status, trackingNumber: null, userId: "user-1" }, settings());
      assert.equal(sent[0].subject, "Order Status Update #2030-0042", status);
      assert.match(sent[0].html, pattern, status);
      assert.doesNotMatch(sent[0].html, /Tracking Number/, status);
    }
    sent.length = 0;
    await sendOrderStatusEmail("buyer@example.test", { id: "abcdef123456", orderNumber: "#2030-0042", status: "SHIPPED", trackingNumber: "<b>TRACK1</b>", userId: "user-1" }, settings());
    assert.match(sent[0].html, /Tracking Number/);
    assert.match(sent[0].html, /&lt;b&gt;TRACK1/);
    assert.doesNotMatch(sent[0].html, /<b>TRACK1/);
    assert.match(sent[0].html, /\/orders\/abcdef123456/);
  } finally { restore(); }
});

test("send helpers never throw and never log the recipient when the provider fails or is off", async () => {
  const failing = setup({ failSend: true });
  try {
    const { sendOrderPlacedEmails, sendOrderStatusEmail, sendLowStockEmail, sendPasswordResetEmail } = failing.load("lib/email.ts");
    await sendOrderPlacedEmails(order(), settings());
    await sendOrderStatusEmail("buyer@example.test", { id: "o1", orderNumber: null, status: "CONFIRMED", trackingNumber: null, userId: "user-1" }, settings());
    assert.equal(await sendLowStockEmail("Widget", 1, settings()), false);
    assert.equal(await sendPasswordResetEmail("buyer@example.test", "https://shop.example.test/reset?token=abc"), null);
    assert.ok(failing.logs.length > 0);
    assert.ok(failing.logs.every((line) => !/buyer@example\.test|help@acme\.test|token=abc/.test(line)), failing.logs.join("\n"));
  } finally { failing.restore(); }

  const off = setup();
  try {
    delete process.env.RESEND_API_KEY;
    const { sendOrderPlacedEmails, sendOrderStatusEmail } = off.load("lib/email.ts");
    await sendOrderPlacedEmails(order(), settings());
    await sendOrderStatusEmail("buyer@example.test", { id: "o1", orderNumber: "#1", status: "SHIPPED", trackingNumber: "TRK-9981", userId: null }, settings());
    assert.equal(off.sent.length, 0);
    assert.ok(off.logs.some((line) => /RESEND_API_KEY/.test(line)));
    assert.ok(off.logs.every((line) => !/buyer@example\.test|TRK-9981/.test(line)));
  } finally { off.restore(); }
});

test("password reset keeps its two-argument form, uses the settings store name and escapes the link", async () => {
  const { load, sent, restore } = setup();
  try {
    const { sendPasswordResetEmail } = load("lib/email.ts");
    await sendPasswordResetEmail("user@example.test", 'https://shop.example.test/reset?a=1&b="x"');
    assert.match(sent[0].html, /STORE/);
    assert.match(sent[0].html, /&amp;b=&quot;x&quot;/);
    sent.length = 0;
    await sendPasswordResetEmail("user@example.test", "https://shop.example.test/reset", settings({ storeName: "Acme" }));
    assert.match(sent[0].html, /ACME/);
  } finally { restore(); }
});

// ---------------------------------------------------------------------------
// Low-stock alerts
// ---------------------------------------------------------------------------

function inventoryHarness(products: any[], emailResult = true) {
  const alerts = new Map<string, { threshold: number; lastAlertAt: Date | null }>();
  for (const product of products) if (product.inventoryAlert) alerts.set(product.id, { ...product.inventoryAlert });
  const emails: [string, number][] = [];
  const db = {
    product: {
      findMany: async ({ where }: any) => products
        .filter((product) => where.id.in.includes(product.id))
        .map((product) => ({ ...product, inventoryAlert: alerts.has(product.id) ? { ...alerts.get(product.id) } : null })),
    },
    inventoryAlert: {
      updateMany: async ({ where, data }: any) => {
        const ids: string[] = where.productId.in ?? [where.productId];
        let count = 0;
        for (const id of ids) {
          const row = alerts.get(id);
          if (!row) continue;
          if ("lastAlertAt" in where && where.lastAlertAt === null && row.lastAlertAt !== null) continue;
          row.lastAlertAt = data.lastAlertAt;
          count++;
        }
        return { count };
      },
      createMany: async ({ data }: any) => {
        let count = 0;
        for (const row of data) {
          if (alerts.has(row.productId)) continue;
          alerts.set(row.productId, { threshold: row.threshold, lastAlertAt: row.lastAlertAt });
          count++;
        }
        return { count };
      },
    },
  };
  const load = moduleLoader({
    "@/lib/db": { db },
    "@/lib/email": { sendLowStockEmail: async (name: string, stock: number) => { emails.push([name, stock]); return emailResult; } },
  });
  return { module: load("lib/inventory-alerts.ts"), db, alerts, emails };
}

const logsSilenced = <T>(run: () => Promise<T>) => {
  const original = { warn: console.warn, error: console.error };
  console.warn = () => {}; console.error = () => {};
  return run().finally(() => Object.assign(console, original));
};

test("low-stock alert is sent once per product until restocked", async () => {
  const products = [
    { id: "p1", name: "Widget", stock: 2, isArchived: false, inventoryAlert: null },
    { id: "p2", name: "Plenty", stock: 50, isArchived: false, inventoryAlert: null },
    { id: "p3", name: "Retired", stock: 0, isArchived: true, inventoryAlert: null },
    { id: "p4", name: "Custom", stock: 8, isArchived: false, inventoryAlert: { threshold: 10, lastAlertAt: null } },
  ];
  const { module, alerts, emails, db } = inventoryHarness(products);
  assert.equal(module.DEFAULT_LOW_STOCK_THRESHOLD, 5);

  await module.notifyLowStock(["p1", "p2", "p3", "p4", "p1"], null);
  assert.deepEqual(emails.map(([name]) => name).sort(), ["Custom", "Widget"]);
  assert.ok(alerts.get("p1")!.lastAlertAt);

  // A second paid order for the same products sends nothing.
  await module.notifyLowStock(["p1", "p4"], null);
  assert.equal(emails.length, 2);

  // Concurrent confirmations claim the alert atomically: exactly one wins.
  const racing = inventoryHarness([{ id: "r1", name: "Racer", stock: 1, isArchived: false, inventoryAlert: { threshold: 5, lastAlertAt: null } }]);
  await Promise.all([racing.module.notifyLowStock(["r1"], null), racing.module.notifyLowStock(["r1"], null)]);
  assert.equal(racing.emails.length, 1);

  // Restocking re-arms only products at or above their threshold.
  products[0].stock = 20;
  await module.rearmLowStockAlerts(db, ["p1", "p4"]);
  assert.equal(alerts.get("p1")!.lastAlertAt, null);
  assert.ok(alerts.get("p4")!.lastAlertAt);
  products[0].stock = 1;
  await module.notifyLowStock(["p1"], null);
  assert.equal(emails.length, 3);
});

test("a failed low-stock email re-arms the alert and notifyLowStock never throws", async () => {
  const failed = inventoryHarness([{ id: "p1", name: "Widget", stock: 1, isArchived: false, inventoryAlert: null }], false);
  await logsSilenced(() => failed.module.notifyLowStock(["p1"], null));
  assert.equal(failed.emails.length, 1);
  assert.equal(failed.alerts.get("p1")!.lastAlertAt, null);

  const broken = moduleLoader({
    "@/lib/db": { db: { product: { findMany: async () => { throw new Error("db down"); } } } },
    "@/lib/email": { sendLowStockEmail: async () => true },
  })("lib/inventory-alerts.ts");
  await logsSilenced(() => broken.notifyLowStock(["p1"], null));
  await broken.notifyLowStock([], null);
});
