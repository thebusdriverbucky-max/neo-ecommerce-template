import assert from "node:assert/strict";
import test from "node:test";
import { moduleLoader } from "./helpers/load-module";

const load = moduleLoader({});
const money = load("lib/order-money.ts");
const lifecycle = load("lib/order-lifecycle.ts");
const cart = load("lib/cart-reconciliation.ts");
const tokens = load("lib/guest-order-token.ts");
const manual = load("lib/manual-order.ts");

test("integer money rounds once and applies discount once", () => {
  assert.equal(money.toMinorUnits("10.005"), 1001);
  const result = money.calculateOrderMoney({
    lines: [{ unitPrice: "19.99", quantity: 3 }],
    discount: { type: "PERCENT", value: 10 },
    taxRatePercent: 8.25,
    shippingMinor: 500,
  });
  assert.deepEqual(result, {
    subtotalMinor: 5997,
    discountMinor: 600,
    taxableMinor: 5397,
    taxMinor: 445,
    shippingMinor: 500,
    totalMinor: 6342,
  });
  assert.equal(money.fromMinorUnits(result.totalMinor), 63.42);
});

test("cart reconciliation subtracts the submitted snapshot but preserves later additions", () => {
  const current = [
    { productId: "a", quantity: 3, name: "A" },
    { productId: "b", quantity: 1, name: "B" },
    { productId: "new", quantity: 2, name: "New" },
  ];
  assert.deepEqual(cart.reconcilePurchasedCart(current, [{ productId: "a", quantity: 2 }, { productId: "b", quantity: 1 }]), [
    { productId: "a", quantity: 1, name: "A" },
    { productId: "new", quantity: 2, name: "New" },
  ]);
});

test("guest order tokens are order-bound, signed and expiring", () => {
  process.env.GUEST_ORDER_TOKEN_SECRET = "isolated-test-secret-that-is-at-least-32-characters";
  try {
    const expiry = new Date("2030-01-02T00:00:00Z");
    const token = tokens.createGuestOrderToken("order-a", expiry);
    assert.equal(tokens.verifyGuestOrderToken(token, "order-a", new Date("2030-01-01T00:00:00Z")), true);
    assert.equal(tokens.verifyGuestOrderToken(token, "order-b", new Date("2030-01-01T00:00:00Z")), false);
    assert.equal(tokens.verifyGuestOrderToken(token.replace(/.$/, "x"), "order-a", new Date("2030-01-01T00:00:00Z")), false);
    assert.equal(tokens.verifyGuestOrderToken(token, "order-a", expiry), false);
  } finally {
    delete process.env.GUEST_ORDER_TOKEN_SECRET;
  }
});

type State = {
  products: any[];
  orders: any[];
  addresses: any[];
  discounts: any[];
  settings: any;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function fakeDb(seed?: Partial<State>) {
  let state: State = {
    products: [
      { id: "product000000000000000000001", name: "Product", price: "10.00", stock: 5, isArchived: false },
      { id: "product000000000000000000002", name: "Other", price: "2.55", stock: 5, isArchived: false },
    ],
    orders: [],
    addresses: [],
    discounts: [],
    settings: {
      currency: "EUR", taxRate: 10, shippingCost: 5, freeShippingThreshold: 50,
      paymentIban: "DE001", paymentBankName: "Bank", paymentAccountName: "Merchant", paymentDetails: "Use order number",
    },
    ...seed,
  };
  let queue = Promise.resolve();

  const api = (working: State): any => ({
    storeSettings: { findFirst: async () => working.settings },
    address: {
      count: async ({ where }: any) => working.addresses.filter((a) => where.id.in.includes(a.id) && a.userId === where.userId).length,
      create: async ({ data }: any) => {
        const address = { id: `address-${working.addresses.length + 1}`, ...data };
        working.addresses.push(address);
        return address;
      },
    },
    product: {
      findMany: async ({ where }: any) => working.products.filter((p) => where.id.in.includes(p.id)),
      updateMany: async ({ where, data }: any) => {
        const product = working.products.find((p) => p.id === where.id);
        if (!product || where.isArchived === false && product.isArchived || where.stock?.gte != null && product.stock < where.stock.gte) return { count: 0 };
        if (data.stock?.decrement) product.stock -= data.stock.decrement;
        return { count: 1 };
      },
      update: async ({ where, data }: any) => {
        const product = working.products.find((p) => p.id === where.id);
        if (!product) throw new Error("missing product");
        if (data.stock?.increment) product.stock += data.stock.increment;
        return product;
      },
    },
    discountCode: {
      findUnique: async ({ where }: any) => working.discounts.find((d) => d.code === where.code) || null,
      updateMany: async ({ where, data }: any) => {
        const discount = working.discounts.find((d) => d.id === where.id || d.code === where.code);
        if (!discount || !discount.isActive || where.used?.lt != null && discount.used >= where.used.lt) return { count: 0 };
        if (where.used?.gt != null && discount.used <= where.used.gt) return { count: 0 };
        discount.used += data.used.increment || -data.used.decrement;
        return { count: 1 };
      },
    },
    order: {
      findUnique: async ({ where }: any) => {
        const found = working.orders.find((o) => o.id === where.id || o.checkoutRequestId === where.checkoutRequestId);
        return found ? { ...found, items: found.items || [], user: found.user || null } : null;
      },
      create: async ({ data }: any) => {
        if (working.orders.some((o) => o.checkoutRequestId === data.checkoutRequestId)) Object.assign(new Error("unique"), { code: "P2002" });
        const order = { id: `order-${working.orders.length + 1}`, ...data, items: data.items.create, user: null };
        working.orders.push(order);
        return order;
      },
      updateMany: async ({ where, data }: any) => {
        const order = working.orders.find((o) => o.id === where.id && o.status === where.status && (where.stockReleasedAt === undefined || o.stockReleasedAt == null));
        if (!order) return { count: 0 };
        Object.assign(order, data);
        return { count: 1 };
      },
      findMany: async ({ where, take }: any) => working.orders.filter((o) => o.status === where.status && o.stockReleasedAt == null && o.reservationExpiresAt <= where.reservationExpiresAt.lte).slice(0, take),
    },
  });

  const db: any = api(state);
  db.$transaction = async (callback: any) => {
    const previous = queue;
    let release!: () => void;
    queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const working = clone(state);
    try {
      const result = await callback(api(working));
      state = working;
      Object.assign(db, api(state));
      return result;
    } finally {
      release();
    }
  };
  db.state = () => state;
  return db;
}

const baseInput = {
  actor: { userId: "user-1", guestEmail: null },
  idempotencyKey: "request_12345678",
  items: [
    { productId: "product000000000000000000001", quantity: 2 },
    { productId: "product000000000000000000001", quantity: 2 },
  ],
  shippingAddress: { firstName: "A", lastName: "B", email: "a@example.test", phone: "1", street: "S", city: "C", state: "", postalCode: "P", country: "DE" },
  now: new Date("2030-01-01T00:00:00Z"),
};

test("creation aggregates duplicate lines, uses server totals/snapshot and conditionally reserves stock", async () => {
  const db = fakeDb();
  const result = await manual.createManualOrder(db, baseInput);
  assert.equal(result.total, 49);
  assert.equal(result.currency, "EUR");
  assert.equal(result.paymentIban, "DE001");
  assert.deepEqual(result.purchasedItems, [{ productId: "product000000000000000000001", quantity: 4 }]);
  assert.equal(db.state().products[0].stock, 1);
  assert.equal(db.state().orders[0].discountAmount, 0);
  assert.equal(db.state().orders[0].reservationExpiresAt.toISOString(), "2030-01-08T00:00:00.000Z");
});

test("discount availability and rounding are enforced inside the order transaction", async () => {
  const baseDiscount = { id: "d1", code: "SAVE", type: "PERCENT", value: 10, isActive: true, used: 0 };
  for (const override of [
    { value: 0 }, { value: -1 }, { value: 150 }, { type: "FIXED", value: -5 },
    { expiresAt: baseInput.now }, { isActive: false }, { minAmount: 100 }, { usageLimit: 1, used: 1 },
  ]) {
    const db = fakeDb({ discounts: [{ ...baseDiscount, ...override }] });
    await assert.rejects(() => manual.createManualOrder(db, { ...baseInput, discountCode: " save ",
      items: [{ productId: "product000000000000000000001", quantity: 1 }] }), /invalid|expired|inactive|minimum|limit/i);
    assert.equal(db.state().orders.length, 0);
    assert.equal(db.state().products[0].stock, 5);
  }
  const db = fakeDb({ discounts: [{ ...baseDiscount, type: "FIXED", value: 200, usageLimit: 1 }] });
  await manual.createManualOrder(db, { ...baseInput, discountCode: " save ",
    items: [{ productId: "product000000000000000000001", quantity: 1 }] });
  assert.equal(db.state().orders[0].discountAmount, 10);
  assert.equal(db.state().orders[0].tax, 0);
  assert.equal(db.state().orders[0].total, 5);
  assert.equal(db.state().discounts[0].used, 1);
});

test("discount caps including zero remain consistent with previews", async () => {
  for (const [maxDiscount, expected] of [[0, 0], [1.25, 1.25]] as const) {
    const db = fakeDb({ discounts: [{ id: "d1", code: "SAVE", type: "PERCENT", value: 50, maxDiscount, isActive: true, used: 0 }] });
    await manual.createManualOrder(db, { ...baseInput, discountCode: "SAVE",
      items: [{ productId: "product000000000000000000001", quantity: 1 }] });
    assert.equal(db.state().orders[0].discountAmount, expected);
  }
});

test("concurrent orders cannot claim a single-use discount twice", async () => {
  const db = fakeDb({ discounts: [{ id: "d1", code: "ONCE", type: "FIXED", value: 1, isActive: true, used: 0, usageLimit: 1 }] });
  const results = await Promise.allSettled(["request_first_123", "request_second_123"].map(idempotencyKey =>
    manual.createManualOrder(db, { ...baseInput, idempotencyKey, discountCode: "ONCE",
      items: [{ productId: "product000000000000000000001", quantity: 1 }] })));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(db.state().orders.length, 1);
  assert.equal(db.state().discounts[0].used, 1);
  assert.equal(db.state().products[0].stock, 4);
});

test("checkout without an IBAN still creates a seven-day reservation with a nullable payment snapshot", async () => {
  const db = fakeDb({
    settings: {
      currency: "EUR", taxRate: 0, shippingCost: 0, freeShippingThreshold: 50,
      paymentIban: null, paymentBankName: null, paymentAccountName: null,
      paymentDetails: "We will contact you with payment instructions.",
    },
  });
  const result = await manual.createManualOrder(db, {
    ...baseInput,
    items: [{ productId: "product000000000000000000001", quantity: 1 }],
  });
  assert.equal(result.paymentIban, null);
  assert.equal(result.paymentDetails, "We will contact you with payment instructions.");
  assert.equal(result.reservationExpiresAt.toISOString(), "2030-01-08T00:00:00.000Z");
  assert.equal(db.state().products[0].stock, 4);
});

test("transaction rollback leaves stock/address/coupon untouched on insufficient aggregated stock", async () => {
  const db = fakeDb({ discounts: [{ id: "d1", code: "SAVE", type: "FIXED", value: 1, isActive: true, used: 0, usageLimit: 1 }] });
  await assert.rejects(() => manual.createManualOrder(db, {
    ...baseInput,
    discountCode: "save",
    items: [{ productId: "product000000000000000000001", quantity: 4 }, { productId: "product000000000000000000001", quantity: 2 }],
  }), manual.OrderConflictError);
  assert.equal(db.state().products[0].stock, 5);
  assert.equal(db.state().discounts[0].used, 0);
  assert.equal(db.state().addresses.length, 0);
  assert.equal(db.state().orders.length, 0);
});

test("address IDs are owner-only and guests cannot attach stored addresses", async () => {
  const db = fakeDb({ addresses: [{ id: "address00000000000000000001", userId: "other" }] });
  await assert.rejects(() => manual.createManualOrder(db, {
    ...baseInput,
    shippingAddress: undefined,
    shippingAddressId: "address00000000000000000001",
  }), manual.OrderInputError);
  await assert.rejects(() => manual.createManualOrder(db, {
    ...baseInput,
    actor: { userId: null, guestEmail: "guest@example.test" },
    shippingAddress: undefined,
    shippingAddressId: "address00000000000000000001",
  }), manual.OrderInputError);
});

test("concurrent same-key checkout creates and reserves exactly once; changed payload conflicts", async () => {
  const db = fakeDb();
  const [first, second] = await Promise.all([
    manual.createManualOrder(db, baseInput),
    manual.createManualOrder(db, baseInput),
  ]);
  assert.equal(first.orderId, second.orderId);
  assert.equal(db.state().orders.length, 1);
  assert.equal(db.state().products[0].stock, 1);
  await assert.rejects(() => manual.createManualOrder(db, { ...baseInput, items: [{ productId: "product000000000000000000002", quantity: 1 }] }), manual.OrderConflictError);
});

test("strict transitions release once; expired late payment requires recovery before confirmation", async () => {
  const db = fakeDb();
  const created = await manual.createManualOrder(db, { ...baseInput, items: [{ productId: "product000000000000000000001", quantity: 2 }] });
  const expiry = new Date("2030-01-09T00:00:00Z");
  await assert.rejects(() => manual.transitionManualOrder(db, { orderId: created.orderId, nextStatus: "CONFIRMED", adminUserId: "admin", now: expiry }), manual.OrderConflictError);
  await manual.transitionManualOrder(db, { orderId: created.orderId, nextStatus: "CANCELLED", adminUserId: "cron", expiration: true, now: expiry });
  assert.equal(db.state().products[0].stock, 5);
  await assert.rejects(() => manual.transitionManualOrder(db, { orderId: created.orderId, nextStatus: "CANCELLED", adminUserId: "admin", now: expiry }), /Invalid order transition/);
  assert.equal(db.state().products[0].stock, 5);
  await manual.transitionManualOrder(db, { orderId: created.orderId, nextStatus: "PENDING", adminUserId: "admin", recoverExpired: true, now: expiry });
  assert.equal(db.state().products[0].stock, 3);
  await manual.transitionManualOrder(db, { orderId: created.orderId, nextStatus: "CONFIRMED", adminUserId: "admin", now: expiry });
  assert.equal(db.state().orders[0].paymentConfirmedBy, "admin");
  assert.equal(db.state().products[0].stock, 3);
});

test("shipped refund restocks once and unpaid cancellation releases/reclaims coupon usage", async () => {
  const db = fakeDb({ discounts: [{ id: "d1", code: "SAVE", type: "FIXED", value: 1, isActive: true, used: 0, usageLimit: 1 }] });
  const created = await manual.createManualOrder(db, {
    ...baseInput,
    discountCode: "SAVE",
    items: [{ productId: "product000000000000000000001", quantity: 1 }],
  });
  assert.equal(db.state().discounts[0].used, 1);
  await manual.transitionManualOrder(db, { orderId: created.orderId, nextStatus: "CANCELLED", adminUserId: "admin", expiration: true, now: new Date("2030-01-02T00:00:00Z") });
  assert.equal(db.state().discounts[0].used, 0);
  await manual.transitionManualOrder(db, { orderId: created.orderId, nextStatus: "PENDING", adminUserId: "admin", recoverExpired: true, now: new Date("2030-01-02T01:00:00Z") });
  assert.equal(db.state().discounts[0].used, 1);
  await manual.transitionManualOrder(db, { orderId: created.orderId, nextStatus: "CONFIRMED", adminUserId: "admin", now: new Date("2030-01-02T02:00:00Z") });
  await manual.transitionManualOrder(db, { orderId: created.orderId, nextStatus: "PROCESSING", adminUserId: "admin" });
  await manual.transitionManualOrder(db, { orderId: created.orderId, nextStatus: "SHIPPED", adminUserId: "admin" });
  await manual.transitionManualOrder(db, { orderId: created.orderId, nextStatus: "REFUNDED", adminUserId: "admin" });
  assert.equal(db.state().products[0].stock, 5);
  await assert.rejects(() => manual.transitionManualOrder(db, { orderId: created.orderId, nextStatus: "REFUNDED", adminUserId: "admin" }), /Invalid order transition/);
  assert.equal(db.state().products[0].stock, 5);
});

test("transition table rejects customer-style self confirmation and unsafe terminal transitions", () => {
  assert.equal(lifecycle.canTransition("PENDING", "CONFIRMED"), true);
  assert.equal(lifecycle.canTransition("DELIVERED", "PENDING"), false);
  assert.throws(() => lifecycle.assertOrderTransition("CANCELLED", "CONFIRMED"), /Invalid order transition/);
});
