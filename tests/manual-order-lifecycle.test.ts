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
      findMany: async ({ where }: any) => working.addresses.filter((a) => where.id.in.includes(a.id) && a.userId === where.userId),
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
      findUnique: async ({ where, omit }: any) => {
        const found = working.orders.find((o) => o.id === where.id || o.checkoutRequestId === where.checkoutRequestId);
        if (!found) return null;
        const items = (found.items || []).map((item: any) => {
          const product = working.products.find((p) => p.id === item.productId);
          return product ? { ...item, product: { id: product.id, name: product.name } } : item;
        });
        const result = { ...found, items, user: found.user || null };
        for (const [key, hidden] of Object.entries(omit || {})) if (hidden) delete result[key];
        return result;
      },
      count: async ({ where }: any) => working.orders.filter((o) => o.status === where.status
        && o.stockReleasedAt == null && o.reservationExpiresAt > where.reservationExpiresAt.gt
        && (where.userId === undefined || o.userId === where.userId)
        && (where.guestEmail === undefined || o.guestEmail === where.guestEmail)
        && (where.checkoutIpHash === undefined || o.checkoutIpHash === where.checkoutIpHash)).length,
      create: async ({ data }: any) => {
        if (working.orders.some((o) => o.checkoutRequestId === data.checkoutRequestId)) throw Object.assign(new Error("unique"), { code: "P2002" });
        const order = { id: `order-${working.orders.length + 1}`, ...data, items: data.items.create, user: null };
        working.orders.push(order);
        return order;
      },
      updateMany: async ({ where, data }: any) => {
        const order = working.orders.find((o) => o.id === where.id
          && (where.status === undefined || o.status === where.status)
          && (where.stockReleasedAt === undefined || o.stockReleasedAt == null)
          && (where.reservationExpiresAt?.not !== null || o.reservationExpiresAt != null));
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

const ONE = "product000000000000000000001";
const TWO = "product000000000000000000002";
const EXPIRED_AT = new Date("2030-01-09T00:00:00Z");

function place(db: any, overrides: Record<string, unknown> = {}) {
  return manual.createManualOrder(db, { ...baseInput, items: [{ productId: ONE, quantity: 1 }], ...overrides });
}

function move(db: any, orderId: string, nextStatus: string, extra: Record<string, unknown> = {}) {
  return manual.transitionManualOrder(db, { orderId, nextStatus, adminUserId: "admin", ...extra });
}

async function captureWarnings<T>(run: () => Promise<T>): Promise<{ result: T; warnings: string[] }> {
  const original = console.warn;
  const warnings: string[] = [];
  console.warn = (message: string) => { warnings.push(String(message)); };
  try {
    return { result: await run(), warnings };
  } finally {
    console.warn = original;
  }
}

test("an overdue unpaid order can still be confirmed while its stock is held", async () => {
  const db = fakeDb();
  const created = await place(db, { items: [{ productId: ONE, quantity: 2 }] });
  const confirmed = await move(db, created.orderId, "CONFIRMED", { now: EXPIRED_AT });
  assert.equal(confirmed.status, "CONFIRMED");
  assert.equal(db.state().orders[0].paymentConfirmedBy, "admin");
  assert.equal(db.state().products[0].stock, 3);
  assert.equal(await manual.expirePendingOrders(db, EXPIRED_AT), 0);
  assert.equal(db.state().products[0].stock, 3);
});

test("a transfer that arrives after expiry confirms the order and reserves the stock again", async () => {
  const db = fakeDb();
  const created = await place(db, { items: [{ productId: ONE, quantity: 2 }] });
  assert.equal(await manual.expirePendingOrders(db, EXPIRED_AT), 1);
  assert.equal(db.state().orders[0].status, "CANCELLED");
  assert.equal(db.state().products[0].stock, 5);
  await assert.rejects(() => move(db, created.orderId, "CANCELLED", { now: EXPIRED_AT }), /Invalid order transition/);
  await assert.rejects(() => move(db, created.orderId, "SHIPPED", { now: EXPIRED_AT }), /Invalid order transition/);
  assert.equal(db.state().products[0].stock, 5);

  await move(db, created.orderId, "CONFIRMED", { now: new Date("2030-01-10T00:00:00Z") });
  const stored = db.state().orders[0];
  assert.equal(stored.status, "CONFIRMED");
  assert.equal(stored.paymentConfirmedBy, "admin");
  assert.equal(stored.stockReleasedAt, null);
  assert.equal(stored.reservationExpiredAt, null);
  assert.equal(db.state().products[0].stock, 3);
});

test("late confirmation fails cleanly when the stock was sold; a manual cancellation stays closed", async () => {
  const db = fakeDb();
  const created = await place(db, { items: [{ productId: ONE, quantity: 5 }] });
  await manual.expirePendingOrders(db, EXPIRED_AT);
  await place(db, { idempotencyKey: "request_other_123", actor: { userId: "user-2", guestEmail: null } });
  assert.equal(db.state().products[0].stock, 4);
  await assert.rejects(() => move(db, created.orderId, "CONFIRMED", { now: EXPIRED_AT }), /Not enough stock to reserve "Product" again/);
  assert.equal(db.state().orders[0].status, "CANCELLED");
  assert.ok(db.state().orders[0].reservationExpiredAt);
  assert.equal(db.state().products[0].stock, 4);

  const cancelled = await place(db, { idempotencyKey: "request_third_123", actor: { userId: "user-3", guestEmail: null } });
  await move(db, cancelled.orderId, "CANCELLED");
  assert.equal(db.state().products[0].stock, 4);
  await assert.rejects(() => move(db, cancelled.orderId, "CONFIRMED"), /Invalid order transition/);
});

test("unpaid cancellation releases the coupon; a late payment honours it while re-opening keeps the limit", async () => {
  const db = fakeDb({ discounts: [{ id: "d1", code: "SAVE", type: "FIXED", value: 1, isActive: true, used: 0, usageLimit: 1 }] });
  const created = await place(db, { discountCode: "SAVE" });
  assert.equal(db.state().discounts[0].used, 1);
  await move(db, created.orderId, "CANCELLED", { expiration: true, now: new Date("2030-01-02T00:00:00Z") });
  assert.equal(db.state().discounts[0].used, 0);
  // Older admin clients re-open an expired order as Pending first.
  await move(db, created.orderId, "PENDING", { recoverExpired: true, now: new Date("2030-01-02T01:00:00Z") });
  assert.equal(db.state().discounts[0].used, 1);
  assert.equal(db.state().orders[0].reservationExpiresAt.toISOString(), "2030-01-09T01:00:00.000Z");
  await move(db, created.orderId, "CANCELLED", { expiration: true, now: new Date("2030-01-10T00:00:00Z") });
  assert.equal(db.state().discounts[0].used, 0);

  await place(db, { idempotencyKey: "request_other_123", actor: { userId: "user-2", guestEmail: null }, discountCode: "SAVE" });
  assert.equal(db.state().discounts[0].used, 1);
  await assert.rejects(() => move(db, created.orderId, "PENDING", { recoverExpired: true }), /limit is exhausted/);
  assert.equal(db.state().orders[0].status, "CANCELLED");
  assert.equal(db.state().products[0].stock, 4);
  await move(db, created.orderId, "CONFIRMED");
  assert.equal(db.state().discounts[0].used, 2);
  assert.equal(db.state().products[0].stock, 3);

  const deleted = fakeDb({ discounts: [{ id: "d1", code: "SAVE", type: "FIXED", value: 1, isActive: true, used: 0 }] });
  const order = await place(deleted, { discountCode: "SAVE" });
  await manual.expirePendingOrders(deleted, EXPIRED_AT);
  deleted.state().discounts.length = 0;
  await move(deleted, order.orderId, "CONFIRMED");
  assert.equal(deleted.state().orders[0].status, "CONFIRMED");
  assert.equal(deleted.state().orders[0].total, 14.9);
});

test("refunds return stock only when asked and before shipping; paid orders cannot be cancelled", async () => {
  const db = fakeDb();
  const packed = await place(db);
  await move(db, packed.orderId, "CONFIRMED");
  await move(db, packed.orderId, "PROCESSING");
  await assert.rejects(() => move(db, packed.orderId, "CANCELLED"), /Invalid order transition/);
  const released: string[][] = [];
  await move(db, packed.orderId, "REFUNDED", {
    restock: true,
    onStockReleased: async (ids: string[]) => {
      assert.equal(db.state().orders[0].status, "REFUNDED");
      released.push(ids);
    },
  });
  assert.deepEqual(released, [[ONE]]);
  assert.equal(db.state().products[0].stock, 5);
  await assert.rejects(() => move(db, packed.orderId, "REFUNDED", { restock: true }), /Invalid order transition/);
  assert.equal(db.state().products[0].stock, 5);

  const shipped = await place(db, { idempotencyKey: "request_second_123" });
  await move(db, shipped.orderId, "CONFIRMED");
  await move(db, shipped.orderId, "SHIPPED");
  await assert.rejects(() => move(db, shipped.orderId, "REFUNDED", { restock: true }), manual.OrderConflictError);
  await move(db, shipped.orderId, "REFUNDED");
  assert.equal(db.state().products[0].stock, 4);

  const kept = await place(db, { idempotencyKey: "request_third_123" });
  await move(db, kept.orderId, "CONFIRMED");
  await move(db, kept.orderId, "REFUNDED");
  assert.equal(db.state().products[0].stock, 3);
  const unpaid = await place(db, { idempotencyKey: "request_fourth_123", actor: { userId: "user-2", guestEmail: null } });
  await assert.rejects(() => move(db, unpaid.orderId, "CANCELLED", { restock: true }), manual.OrderConflictError);
});

test("open reservations are capped per customer and per client network", async () => {
  const db = fakeDb({ products: [{ id: ONE, name: "Product", price: "10.00", stock: 100, isArchived: false }] });
  for (const key of ["request_a_1234", "request_b_1234", "request_c_1234"]) await place(db, { idempotencyKey: key });
  await assert.rejects(() => place(db, { idempotencyKey: "request_d_1234" }), manual.OrderLimitError);
  assert.equal((await place(db, { idempotencyKey: "request_a_1234" })).replayed, true);
  await move(db, db.state().orders[0].id, "CONFIRMED");
  await place(db, { idempotencyKey: "request_d_1234" });
  // Reservations past their date no longer hold a slot.
  await place(db, { idempotencyKey: "request_e_1234", now: EXPIRED_AT });

  const guest = (key: string, guestEmail: string) => place(db, { idempotencyKey: key, actor: { userId: null, guestEmail } });
  for (const key of ["guest_a_1234", "guest_b_1234", "guest_c_1234"]) await guest(key, "Guest@Example.test");
  await assert.rejects(() => guest("guest_d_1234", "guest@example.test"), manual.OrderLimitError);

  const network = (user: string, checkoutIpHash: string | null) =>
    place(db, { idempotencyKey: `request_${user}_1234`, actor: { userId: user, guestEmail: null }, checkoutIpHash });
  for (const user of ["n1", "n2", "n3", "n4", "n5"]) await network(user, "hash-1");
  await assert.rejects(() => network("n6", "hash-1"), /Too many unpaid orders from your network/);
  await network("n7", "hash-2");
  await network("n8", null);
  const capped = db.state().orders.find((order: any) => order.userId === "n1");
  await move(db, capped.id, "CONFIRMED");
  assert.equal(db.state().orders.find((order: any) => order.id === capped.id).checkoutIpHash, null);
  await network("n6", "hash-1");
});

test("checkout only ships to enabled countries, including saved addresses", async () => {
  const settings = {
    currency: "EUR", taxRate: 0, shippingCost: 5, freeShippingThreshold: null, enabledCountries: ["DE", "France"],
    paymentIban: "DE001", paymentBankName: null, paymentAccountName: null, paymentDetails: null,
  };
  const db = fakeDb({ settings, addresses: [{ id: "address00000000000000000001", userId: "user-1", country: "US" }] });
  const address = (country: string) => ({ ...baseInput.shippingAddress, country });
  await assert.rejects(() => place(db, { shippingAddress: address("US") }), /do not ship/);
  await assert.rejects(() => place(db, { shippingAddress: undefined, shippingAddressId: "address00000000000000000001" }), /do not ship/);
  assert.equal(db.state().products[0].stock, 5);
  await place(db, { shippingAddress: address("de") });
  await place(db, { idempotencyKey: "request_france_1", shippingAddress: address("FR") });
  const open = fakeDb({ settings: { ...settings, enabledCountries: [] } });
  await place(open, { shippingAddress: address("US") });
});

test("free shipping can be disabled, always on, or reached by the subtotal before discounts", async () => {
  const totalFor = async (freeShippingThreshold: unknown, overrides: Record<string, unknown> = {}, shippingCost: unknown = 5) => {
    const db = fakeDb({
      settings: { currency: "EUR", taxRate: 0, shippingCost, freeShippingThreshold, paymentIban: "DE001" },
      discounts: [{ id: "d1", code: "TEN", type: "FIXED", value: 10, isActive: true, used: 0 }],
    });
    return (await place(db, { items: [{ productId: ONE, quantity: 5 }], ...overrides })).total;
  };
  assert.equal(await totalFor(null), 55);
  assert.equal(await totalFor(0), 50);
  assert.equal(await totalFor(50), 50);
  assert.equal(await totalFor(60), 55);
  assert.equal(await totalFor(2_000_000), 55);
  assert.equal(await totalFor(50, { discountCode: "TEN" }), 40);
  await assert.rejects(() => totalFor(null, {}, Number.NaN), manual.OrderConfigurationError);
});

test("orders without an IBAN can be confirmed and still expire", async () => {
  const db = fakeDb({
    settings: {
      currency: "EUR", taxRate: 0, shippingCost: 0, freeShippingThreshold: null,
      paymentIban: null, paymentBankName: null, paymentAccountName: null, paymentDetails: "We will email you the bank details.",
    },
  });
  const paid = await place(db);
  await place(db, { idempotencyKey: "request_unpaid_1" });
  await move(db, paid.orderId, "CONFIRMED");
  assert.equal(db.state().orders[0].status, "CONFIRMED");
  assert.equal(await manual.expirePendingOrders(db, EXPIRED_AT), 1);
  assert.equal(db.state().orders[1].status, "CANCELLED");
  assert.equal(db.state().products[0].stock, 4);
});

test("tracking can be changed on its own and internal checkout fields never leave the server", async () => {
  const db = fakeDb();
  const created = await place(db, { checkoutIpHash: "hash-1" });
  await move(db, created.orderId, "CONFIRMED");
  const shipped = await move(db, created.orderId, "SHIPPED", { trackingNumber: "TRK-1" });
  assert.equal(shipped.trackingNumber, "TRK-1");
  const tracked = await manual.updateOrderTracking(db, { orderId: created.orderId, trackingNumber: "TRK-2" });
  assert.equal(tracked.status, "SHIPPED");
  assert.equal(tracked.trackingNumber, "TRK-2");
  for (const order of [shipped, tracked]) {
    for (const field of Object.keys(manual.INTERNAL_ORDER_FIELDS)) assert.equal(field in order, false, field);
  }
  assert.equal((await manual.updateOrderTracking(db, { orderId: created.orderId, trackingNumber: null })).trackingNumber, null);

  db.state().orders.push({ id: "card-order", status: "CONFIRMED", reservationExpiresAt: null, items: [] });
  await assert.rejects(() => manual.updateOrderTracking(db, { orderId: "card-order", trackingNumber: "X" }), manual.OrderInputError);
  await assert.rejects(() => move(db, "card-order", "SHIPPED"), manual.OrderInputError);
});

test("one broken expired order does not block the others and stock follow-ups never fail a release", async () => {
  const db = fakeDb();
  await place(db);
  await place(db, { idempotencyKey: "request_second_123", items: [{ productId: TWO, quantity: 1 }] });
  db.state().products.splice(1, 1);
  const released: string[][] = [];
  const { result, warnings } = await captureWarnings(() => manual.expirePendingOrders(db, EXPIRED_AT, 100, {
    onStockReleased: async (ids: string[]) => { released.push(ids); },
  }));
  assert.equal(result, 1);
  assert.deepEqual(released, [[ONE]]);
  assert.equal(db.state().orders[0].status, "CANCELLED");
  assert.equal(db.state().orders[1].status, "PENDING");
  assert.equal(db.state().products[0].stock, 5);
  assert.ok(warnings.some((line) => line.includes("Expired reservation could not be released")));

  const other = fakeDb();
  await place(other);
  const hookFailure = await captureWarnings(() => manual.expirePendingOrders(other, EXPIRED_AT, 100, {
    onStockReleased: async () => { throw new Error("redis down"); },
  }));
  assert.equal(hookFailure.result, 1);
  assert.equal(other.state().orders[0].status, "CANCELLED");
  assert.equal(other.state().products[0].stock, 5);
  assert.ok(hookFailure.warnings.some((line) => line.includes("Stock release follow-up failed")));
  assert.equal(hookFailure.warnings.some((line) => line.includes("redis down")), false);
});

test("transition table: fulfilment moves forward and may skip steps; paid orders close as refunded", () => {
  assert.equal(lifecycle.canTransition("PENDING", "CONFIRMED"), true);
  assert.equal(lifecycle.canTransition("DELIVERED", "PENDING"), false);
  assert.throws(() => lifecycle.assertOrderTransition("CANCELLED", "CONFIRMED"), /Invalid order transition/);
  for (const [from, to] of [["CONFIRMED", "SHIPPED"], ["CONFIRMED", "DELIVERED"], ["PROCESSING", "DELIVERED"], ["DELIVERED", "REFUNDED"]]) {
    assert.equal(lifecycle.canTransition(from, to), true, `${from} -> ${to}`);
  }
  for (const [from, to] of [["SHIPPED", "PROCESSING"], ["DELIVERED", "SHIPPED"], ["PENDING", "SHIPPED"], ["CONFIRMED", "CANCELLED"], ["SHIPPED", "CANCELLED"], ["REFUNDED", "CONFIRMED"]]) {
    assert.equal(lifecycle.canTransition(from, to), false, `${from} -> ${to}`);
  }
  assert.equal(lifecycle.transitionReleasesStock("PENDING", "CANCELLED"), true);
  assert.equal(lifecycle.transitionReleasesStock("CONFIRMED", "REFUNDED"), false);
  assert.equal(lifecycle.transitionReleasesStock("CONFIRMED", "REFUNDED", true), true);
  assert.equal(lifecycle.transitionReleasesStock("SHIPPED", "REFUNDED", true), false);
});
