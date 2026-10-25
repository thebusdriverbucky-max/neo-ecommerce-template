import assert from "node:assert/strict";
import test from "node:test";
import { moduleLoader } from "./helpers/load-module";

type Sent = { from: string; to: string; subject: string; html: string; replyTo?: string };

function loadEmail(sent: Sent[] = []) {
  class FakeResend {
    emails = {
      send: async (payload: Sent) => {
        sent.push(payload);
        return { data: { id: "email-1" }, error: null };
      },
    };
  }
  const load = moduleLoader({ "@/lib/db": { db: {} }, resend: { Resend: FakeResend } });
  return { email: load("lib/email.ts"), templates: load("lib/email-templates.ts"), sent };
}

async function withEnv<T>(values: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const HOSTILE = '<a href="https://evil.example">Pay now</a>';

function hostileOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    userId: null,
    user: null,
    guestEmail: "guest@example.com",
    guestAccessTokenExpiresAt: null,
    orderNumber: "#2026-000123",
    status: "PROCESSING",
    trackingNumber: null,
    currency: "EUR",
    subtotal: "100.00",
    discountAmount: "10.00",
    shippingCost: "5.00",
    tax: "9.00",
    total: "104.00",
    items: [
      { quantity: 2, price: "50.00", product: { name: `Shirt ${HOSTILE}` } },
    ],
    shippingAddress: {
      firstName: HOSTILE,
      lastName: "<script>alert(1)</script>",
      street: `${HOSTILE} 1`,
      city: "<b>City</b>",
      state: "ST",
      postalCode: "12345",
      country: "DE",
      phone: null,
    },
    ...overrides,
  };
}

test("order emails escape hostile customer, product and address input", async () => {
  const { email, sent } = loadEmail();
  await withEnv({ RESEND_API_KEY: "re_test", NEXT_PUBLIC_APP_URL: undefined, NEXT_PUBLIC_STORE_URL: undefined }, async () => {
    await email.sendOrderPlacedEmails(hostileOrder(), {
      storeName: `Shop ${HOSTILE}`,
      storeEmail: "owner@example.com",
    });
  });

  assert.equal(sent.length, 2);
  for (const message of sent) {
    assert.ok(!message.html.includes("<a href=\"https://evil.example\""), "raw hostile anchor must not be rendered");
    assert.ok(!message.html.includes("<script>"), "script tag must be escaped");
    assert.ok(!message.html.includes("<b>City</b>"));
    assert.match(message.html, /&lt;a href=&quot;https:\/\/evil\.example&quot;&gt;Pay now&lt;\/a&gt;/);
  }
  assert.deepEqual(sent.map((message) => message.to).sort(), ["guest@example.com", "owner@example.com"]);
});

test("order emails show money in the order currency, a discount row and the stored order number", async () => {
  const { email, sent } = loadEmail();
  await withEnv({ RESEND_API_KEY: "re_test", NEXT_PUBLIC_CURRENCY_SYMBOL: "$" }, async () => {
    await email.sendOrderPlacedEmails(hostileOrder(), { storeName: "Shop", storeEmail: "owner@example.com" });
  });

  const customer = sent.find((message) => message.to === "guest@example.com")!;
  assert.match(customer.subject, /#2026-000123/);
  assert.ok(!customer.subject.includes("##"));
  assert.ok(!customer.html.includes("##"));
  assert.ok(customer.html.includes("#2026-000123"));
  assert.ok(customer.html.includes("100.00€"), "line total and subtotal use the EUR formatting");
  assert.ok(customer.html.includes("-10.00€"), "discount row is present");
  assert.ok(customer.html.includes("5.00€"));
  assert.ok(customer.html.includes("9.00€"));
  assert.ok(customer.html.includes("104.00€"));
  assert.ok(!customer.html.includes("$"), "no hard-coded dollar sign");
});

test("discount row is omitted when there is no discount and free shipping is labelled", async () => {
  const { templates } = loadEmail();
  const view = templates.buildOrderEmailView(hostileOrder({ discountAmount: "0.00", shippingCost: "0.00", tax: "0.00", currency: "USD", subtotal: "100.00", total: "100.00" }));
  const html = templates.getOrderConfirmationEmailHtml({ order: view, storeName: "Shop", supportEmail: null, orderUrl: null });
  assert.ok(!html.includes("Discount"));
  assert.ok(html.includes("FREE"));
  assert.ok(html.includes("$100.00"));
  assert.ok(!html.includes("Contact us"), "no contact line without a support email");
  assert.ok(!html.includes("Track Your Order"), "no button without a link");
});

test("support email comes from settings only and is escaped", async () => {
  const { templates } = loadEmail();
  const view = templates.buildOrderEmailView(hostileOrder());
  const html = templates.getOrderConfirmationEmailHtml({ order: view, storeName: "Shop", supportEmail: 'a"b@example.com', orderUrl: 'https://shop.example/orders/1?x="y' });
  assert.ok(html.includes("mailto:a&quot;b@example.com"));
  assert.ok(html.includes('href="https://shop.example/orders/1?x=&quot;y"'));
});

test("status email uses the stored order number, escapes tracking and links guests with a token", async () => {
  const { email, sent } = loadEmail();
  const expires = new Date(Date.now() + 3600_000);
  await withEnv(
    {
      RESEND_API_KEY: "re_test",
      NEXT_PUBLIC_APP_URL: "https://shop.example/",
      GUEST_ORDER_TOKEN_SECRET: "x".repeat(40),
    },
    async () => {
      await email.sendOrderStatusEmail(
        "guest@example.com",
        { id: "order-1", orderNumber: "#2026-000123", status: "SHIPPED", trackingNumber: HOSTILE, userId: null, guestAccessTokenExpiresAt: expires },
        { storeName: "Shop", storeEmail: null },
      );
      await email.sendOrderStatusEmail(
        "user@example.com",
        { id: "order-2", orderNumber: "#2026-000124", status: "DELIVERED", trackingNumber: null, userId: "user-1", guestAccessTokenExpiresAt: null },
        { storeName: "Shop", storeEmail: "help@shop.example" },
      );
    },
  );

  const [guest, member] = sent;
  assert.match(guest.subject, /#2026-000123/);
  assert.ok(!guest.html.includes("##"));
  assert.ok(!guest.html.includes(HOSTILE));
  assert.match(guest.html, /https:\/\/shop\.example\/orders\/order-1\?guest_token=order-1\./);
  assert.ok(!guest.html.includes("Contact us"), "no support line without a support email");
  assert.ok(member.html.includes('href="https://shop.example/orders/order-2"'));
  assert.ok(!member.html.includes("guest_token"));
  assert.ok(member.html.includes("help@shop.example"));
});

test("emails omit the order link when no public URL is configured", async () => {
  const { email, sent } = loadEmail();
  await withEnv({ RESEND_API_KEY: "re_test", NEXT_PUBLIC_APP_URL: undefined, NEXT_PUBLIC_STORE_URL: undefined }, async () => {
    await email.sendOrderStatusEmail(
      "user@example.com",
      { id: "order-2", orderNumber: "#2026-000124", status: "SHIPPED", trackingNumber: null, userId: "user-1", guestAccessTokenExpiresAt: null },
      null,
    );
  });
  assert.ok(!sent[0].html.includes("View Order"));
  assert.ok(!sent[0].html.includes("href="));
});

test("legacy NEXT_PUBLIC_STORE_URL is used when NEXT_PUBLIC_APP_URL is missing", async () => {
  const { email, sent } = loadEmail();
  await withEnv({ RESEND_API_KEY: "re_test", NEXT_PUBLIC_APP_URL: undefined, NEXT_PUBLIC_STORE_URL: "https://legacy.example" }, async () => {
    await email.sendOrderStatusEmail(
      "user@example.com",
      { id: "o3", orderNumber: "#2026-000125", status: "SHIPPED", trackingNumber: null, userId: "user-1", guestAccessTokenExpiresAt: null },
      null,
    );
  });
  assert.ok(sent[0].html.includes("https://legacy.example/orders/o3"));
});

test("low stock, paid-cancelled alerts and password reset escape their inputs", async () => {
  const { email, sent } = loadEmail();
  await withEnv({ RESEND_API_KEY: "re_test", ADMIN_EMAIL: "admin@example.com" }, async () => {
    await email.sendLowStockEmail(`Mug ${HOSTILE}\r\nBcc: x@evil.example`, 2, null);
    await email.sendPaidCancelledOrderAlert(
      { id: "o1", orderNumber: "#2026-000001", total: "20.00", currency: "USD" },
      { paymentIntentId: "pi_1", refundId: null, refundError: HOSTILE },
      { storeName: "Shop", storeEmail: "owner@example.com" },
    );
    await email.sendPasswordResetEmail("user@example.com", 'https://shop.example/reset?token="><script>');
  });

  const [lowStock, alert, reset] = sent;
  assert.equal(lowStock.to, "admin@example.com");
  assert.ok(!/[\r\n]/.test(lowStock.subject), "subject is a single header line");
  assert.ok(!lowStock.html.includes(HOSTILE));
  assert.equal(alert.to, "owner@example.com");
  assert.ok(alert.html.includes("FAILED"));
  assert.ok(alert.html.includes("$20.00"));
  assert.ok(!alert.html.includes(HOSTILE));
  assert.ok(!reset.html.includes("<script>"));
});

test("sendEmail without an API key logs the mock email in development", async () => {
  const { email } = loadEmail();
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => void logs.push(args.map(String).join(" "));
  try {
    await withEnv({ RESEND_API_KEY: undefined, NODE_ENV: "development" }, async () => {
      const result = await email.sendEmail({ to: "a@example.com", subject: "Reset", html: "<p>https://shop/reset?token=SECRET</p>" });
      assert.deepEqual(result, { id: "mock-id" });
    });
  } finally {
    console.log = original;
  }
  assert.ok(logs.some((line) => line.includes("SECRET")));
});

test("sendEmail without an API key in production logs only a warning with the subject", async () => {
  const { email } = loadEmail();
  const output: string[] = [];
  const originals = { log: console.log, warn: console.warn, error: console.error };
  const capture = (...args: unknown[]) => void output.push(args.map(String).join(" "));
  console.log = capture;
  console.warn = capture;
  console.error = capture;
  try {
    await withEnv({ RESEND_API_KEY: undefined, NODE_ENV: "production" }, async () => {
      await email.sendEmail({ to: "victim@example.com", subject: "Password Reset Request", html: "<a href='https://shop/reset?token=SECRET'>x</a>" });
    });
  } finally {
    Object.assign(console, originals);
  }
  const text = output.join("\n");
  assert.ok(text.includes("Password Reset Request"));
  assert.ok(!text.includes("SECRET"));
  assert.ok(!text.includes("<a"));
  assert.ok(!text.includes("victim@example.com"));
});

test("sendEmail passes reply-to to Resend and strips newlines from subjects", async () => {
  const { email, sent } = loadEmail();
  await withEnv({ RESEND_API_KEY: "re_test" }, async () => {
    await email.sendEmail({ to: "a@example.com", subject: "Hi\r\nBcc: x@evil.example", html: "<p>x</p>", replyTo: "visitor@example.com" });
  });
  assert.equal(sent[0].replyTo, "visitor@example.com");
  assert.ok(!/[\r\n]/.test(sent[0].subject));
});
