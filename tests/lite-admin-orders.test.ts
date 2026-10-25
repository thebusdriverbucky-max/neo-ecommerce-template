import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import React from "react";
import { allowedStatusOptions, buildOrderPatch, orderPaymentActions } from "../lib/admin-orders";
import { formatPrice } from "../lib/utils";
import { moduleLoader } from "./helpers/load-module";

const NOW = new Date("2030-01-05T12:00:00Z");
const FUTURE = "2030-01-09T12:00:00.000Z";
const PAST = "2030-01-02T12:00:00.000Z";

test("payment actions follow the bank-transfer lifecycle", () => {
  assert.deepEqual(orderPaymentActions({ status: "PENDING", reservationExpiresAt: FUTURE }, NOW), {
    canConfirmPayment: true, latePayment: false, canCancel: true, canRefund: false, canRestockOnRefund: false,
  });
  // Overdue but not yet cleaned up: still confirmable, flagged as late.
  assert.equal(orderPaymentActions({ status: "PENDING", reservationExpiresAt: PAST }, NOW).latePayment, true);
  // Cancelled by expiry can take a late payment; a manual cancel stays closed.
  assert.deepEqual(orderPaymentActions({ status: "CANCELLED", reservationExpiredAt: PAST }, NOW), {
    canConfirmPayment: true, latePayment: true, canCancel: false, canRefund: false, canRestockOnRefund: false,
  });
  assert.equal(orderPaymentActions({ status: "CANCELLED", reservationExpiredAt: null }, NOW).canConfirmPayment, false);
  // Paid orders are refunded, never cancelled; restock only before shipping.
  for (const status of ["CONFIRMED", "PROCESSING"]) {
    assert.deepEqual(orderPaymentActions({ status }, NOW), {
      canConfirmPayment: false, latePayment: false, canCancel: false, canRefund: true, canRestockOnRefund: true,
    }, status);
  }
  for (const status of ["SHIPPED", "DELIVERED"]) {
    const actions = orderPaymentActions({ status }, NOW);
    assert.equal(actions.canRefund, true, status);
    assert.equal(actions.canRestockOnRefund, false, status);
  }
  assert.deepEqual(orderPaymentActions({ status: "REFUNDED" }, NOW), {
    canConfirmPayment: false, latePayment: false, canCancel: false, canRefund: false, canRestockOnRefund: false,
  });
});

test("fulfilment only moves forward and payment steps are not offered as statuses", () => {
  const values = (status: string) => allowedStatusOptions(status).map((option) => option.value);
  assert.deepEqual(values("PENDING"), ["PENDING"]);
  assert.deepEqual(values("CONFIRMED"), ["CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED"]);
  assert.deepEqual(values("SHIPPED"), ["SHIPPED", "DELIVERED"]);
  assert.deepEqual(values("DELIVERED"), ["DELIVERED"]);
  assert.deepEqual(values("CANCELLED"), ["CANCELLED"]);
});

test("order patch sends only changed fields", () => {
  const current = { status: "SHIPPED", trackingNumber: "TRK-1" };
  assert.deepEqual(buildOrderPatch(current, { status: "SHIPPED", trackingNumber: " TRK-1 " }), { ok: false, error: "No changes to save." });
  assert.deepEqual(buildOrderPatch(current, { status: "SHIPPED", trackingNumber: "" }), { ok: true, payload: { trackingNumber: null } });
  assert.deepEqual(buildOrderPatch(current, { status: "DELIVERED", trackingNumber: "TRK-1" }), { ok: true, payload: { status: "DELIVERED" } });
  assert.equal(buildOrderPatch(current, { status: "SHIPPED", trackingNumber: "x".repeat(201) }).ok, false);
});

type Call = { url: string; method?: string; body: any };

function baseOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    orderNumber: "#2030-ABC123",
    user: { email: "buyer@example.test", name: "Buyer" },
    guestEmail: null,
    shippingAddress: {
      firstName: "Ada", lastName: "Buyer", email: "buyer@example.test", phone: "+49 123",
      street: "Main 1", city: "Berlin", state: "", postalCode: "10115", country: "DE",
    },
    status: "PENDING",
    subtotal: "100.00",
    discountAmount: "10.00",
    discountCode: "SAVE10",
    tax: "0",
    shippingCost: "5.00",
    total: "95.00",
    currency: "EUR",
    createdAt: "2030-01-01T10:00:00.000Z",
    items: [{ product: { name: "Lamp" }, quantity: 2, price: "50.00" }],
    trackingNumber: null,
    paymentIban: "DE89370400440532013000",
    paymentBankName: "Test Bank",
    paymentAccountName: null,
    paymentDetails: null,
    reservationExpiresAt: "2099-01-01T00:00:00.000Z",
    reservationExpiredAt: null,
    paymentConfirmedAt: null,
    ...overrides,
  };
}

async function renderModal(order: Record<string, unknown>, respond: (call: Call) => Response = () => Response.json({ ok: true })) {
  const { JSDOM } = createRequire(import.meta.url)("jsdom");
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const calls: Call[] = [];
  const changed: Array<[string, unknown]> = [];
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string, init: RequestInit = {}) => {
      const call = { url, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(call);
      return respond(call);
    },
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const Modal = moduleLoader({})("components/admin/OrderDetailsModal.tsx").default;
  // react-dom detects input-event support when it first loads, so it is
  // loaded only after the DOM globals exist (otherwise onChange never fires).
  const { act } = await import("react-dom/test-utils");
  const { createRoot } = await import("react-dom/client");
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Modal, {
      order,
      onClose: () => undefined,
      onChanged: async (id: string, updated: unknown) => { changed.push([id, updated]); },
    }));
  });

  const buttons = () => Array.from<HTMLButtonElement>(container.querySelectorAll("button"));
  const button = (label: string | RegExp) => {
    const found = buttons().find((el) => typeof label === "string" ? el.textContent?.trim() === label : label.test(el.textContent || ""));
    assert.ok(found, `button ${label} not found in: ${buttons().map((el) => el.textContent).join(" | ")}`);
    return found!;
  };
  return {
    calls,
    changed,
    text: () => container.textContent || "",
    has: (label: string) => buttons().some((el) => el.textContent?.trim() === label),
    click: async (label: string | RegExp) => {
      await act(async () => { button(label).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
    },
    toggle: async (selector: string) => {
      const input = container.querySelector(selector) as HTMLInputElement;
      await act(async () => { input.click(); });
    },
    type: async (name: string, value: string) => {
      const input = container.querySelector(`input[name="${name}"]`) as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
      await act(async () => {
        setter.call(input, value);
        input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
    },
    cleanup: async () => {
      await act(async () => root.unmount());
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

test("manage window confirms a bank payment after an explicit check of amount and reference", async () => {
  const view = await renderModal(baseOrder(), () => Response.json({ id: "order-1", status: "CONFIRMED" }));
  try {
    const total = formatPrice("95.00", "EUR");
    assert.match(view.text(), /DE89370400440532013000/);
    assert.match(view.text(), /Test Bank/);
    assert.doesNotMatch(view.text(), /Account name/, "empty bank fields are hidden");
    assert.match(view.text(), /Discount \(SAVE10\)/);
    assert.equal(view.has("Save changes"), false, "unpaid orders have nothing to fulfil");

    await view.click("Confirm payment received");
    assert.equal(view.calls.length, 0, "the first click only asks for confirmation");
    assert.ok(view.text().includes(`Did ${total} arrive in your account with reference #2030-ABC123?`));

    await view.click("Yes, payment received");
    assert.deepEqual(view.calls, [{ url: "/api/orders/order-1", method: "PATCH", body: { status: "CONFIRMED" } }]);
    assert.deepEqual(view.changed, [["order-1", { id: "order-1", status: "CONFIRMED" }]]);
    assert.match(view.text(), /Payment confirmed/);
  } finally { await view.cleanup(); }
});

test("manage window offers late confirmation for expired orders and explains missing IBAN", async () => {
  const expired = await renderModal(baseOrder({
    status: "CANCELLED", reservationExpiresAt: "2020-01-01T00:00:00.000Z", reservationExpiredAt: "2020-01-01T01:00:00.000Z",
    paymentIban: null, paymentBankName: null, paymentDetails: "We email the invoice.",
  }));
  try {
    assert.match(expired.text(), /Cancelled automatically/);
    assert.match(expired.text(), /No IBAN was set/);
    assert.match(expired.text(), /We email the invoice\./);
    assert.equal(expired.has("Cancel unpaid order"), false);
    await expired.click("Confirm late payment");
    await expired.click("Yes, payment received");
    assert.deepEqual(expired.calls.map((call) => call.body), [{ status: "CONFIRMED" }]);
  } finally { await expired.cleanup(); }

  const manual = await renderModal(baseOrder({ status: "CANCELLED", reservationExpiredAt: null }));
  try {
    assert.equal(manual.has("Confirm payment received"), false);
    assert.equal(manual.has("Confirm late payment"), false);
    assert.match(manual.text(), /Cancelled without a payment/);
  } finally { await manual.cleanup(); }
});

test("manage window cancels unpaid orders", async () => {
  const view = await renderModal(baseOrder());
  try {
    await view.click("Cancel unpaid order");
    await view.click("Yes, cancel");
    assert.deepEqual(view.calls.map((call) => call.body), [{ status: "CANCELLED" }]);
  } finally { await view.cleanup(); }
});

test("paid orders are refunded, with optional restock only before shipping", async () => {
  const confirmed = await renderModal(baseOrder({ status: "CONFIRMED", paymentConfirmedAt: "2030-01-03T10:00:00.000Z" }));
  try {
    assert.equal(confirmed.has("Cancel unpaid order"), false);
    assert.match(confirmed.text(), /Payment confirmed on/);
    await confirmed.toggle('input[type="checkbox"]');
    await confirmed.click("Mark as refunded");
    await confirmed.click("Yes, it was refunded");
    assert.deepEqual(confirmed.calls.map((call) => call.body), [{ status: "REFUNDED", restock: false }]);
  } finally { await confirmed.cleanup(); }

  const kept = await renderModal(baseOrder({ status: "PROCESSING" }));
  try {
    await kept.click("Mark as refunded");
    await kept.click("Yes, it was refunded");
    assert.deepEqual(kept.calls.map((call) => call.body), [{ status: "REFUNDED", restock: true }]);
  } finally { await kept.cleanup(); }

  const shipped = await renderModal(baseOrder({ status: "SHIPPED", trackingNumber: "TRK-1" }));
  try {
    assert.match(shipped.text(), /Tracking number/);
    assert.equal(shipped.text().includes("Return the items to stock"), false);
    await shipped.click("Mark as refunded");
    await shipped.click("Yes, it was refunded");
    assert.deepEqual(shipped.calls.map((call) => call.body), [{ status: "REFUNDED", restock: false }]);
  } finally { await shipped.cleanup(); }
});

test("fulfilment saves the picked step with the tracking number and shows API errors", async () => {
  const view = await renderModal(baseOrder({ status: "CONFIRMED" }), (call) => call.body.status === "DELIVERED"
    ? Response.json({ error: "Invalid order transition" }, { status: 409 })
    : Response.json({ id: "order-1", status: "SHIPPED", trackingNumber: "TRK-9" }));
  try {
    await view.click(/^Shipped/);
    await view.type("trackingNumber", "  TRK-9 ");
    await view.click("Save changes");
    assert.deepEqual(view.calls[0], { url: "/api/orders/order-1", method: "PATCH", body: { status: "SHIPPED", trackingNumber: "TRK-9" } });
    assert.equal(view.changed.length, 1);

    await view.click(/^Delivered/);
    await view.click("Save changes");
    assert.match(view.text(), /Invalid order transition/);
    assert.equal(view.changed.length, 1, "a failed change does not refresh the order");
  } finally { await view.cleanup(); }
});
