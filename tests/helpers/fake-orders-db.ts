// In-memory stand-in for the Prisma calls used by the payment flow. It
// understands just enough of Prisma's `where` syntax (equality, in/notIn/gte/
// lt/lte, OR, AND) to run the real checkout/confirmation modules.

type Row = Record<string, any>;

export function cuid(label: string): string {
  return `c${label.toLowerCase().replace(/[^a-z0-9]/g, "").padEnd(24, "0").slice(0, 24)}`;
}

function matchesValue(actual: any, expected: any): boolean {
  // Decimal columns compare by value, as in SQL.
  if (typeof expected === "number" && actual !== null && typeof actual === "object") return Number(actual.toString()) === expected;
  if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime();
  if (expected !== null && typeof expected === "object" && !(expected instanceof Date)) {
    if ("equals" in expected) return matchesValue(actual, expected.equals);
    if ("in" in expected) return expected.in.includes(actual);
    if ("notIn" in expected && expected.notIn.includes(actual)) return false;
    const time = (value: any) => (value instanceof Date ? value.getTime() : value);
    if ("gte" in expected && !(time(actual) >= time(expected.gte))) return false;
    if ("lte" in expected && !(Number(actual) <= Number(expected.lte))) return false;
    if ("lt" in expected && !(time(actual) < time(expected.lt))) return false;
    return true;
  }
  return actual === expected;
}

export function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, expected]) => {
    if (key === "OR") return (expected as Row[]).some((clause) => matches(row, clause));
    if (key === "AND") return (Array.isArray(expected) ? expected : [expected]).every((clause: Row) => matches(row, clause));
    return matchesValue(row[key], expected);
  });
}

// Columns that are NULL in the real table unless set.
const ORDER_DEFAULTS = {
  createdAt: new Date(),
  userId: null,
  guestEmail: null,
  guestAccessTokenHash: null,
  guestAccessTokenExpiresAt: null,
  stripeCheckoutSessionId: null,
  stripePaymentIntentId: null,
  trackingNumber: null,
  checkoutIpHash: null,
  checkoutRequestId: null,
  refundedAmount: 0,
};

export function createFakeOrdersDb(initial: {
  orders?: Row[];
  products?: Row[];
  items?: Row[];
  users?: Row[];
  addresses?: Row[];
  settings?: Row | null;
  discountCodes?: Row[];
} = {}) {
  const clone = (rows: Row[] | undefined) => (rows ?? []).map((row) => ({ ...row }));
  const state = {
    orders: clone(initial.orders).map((row) => ({ ...ORDER_DEFAULTS, ...row })) as Row[],
    products: clone(initial.products) as Row[],
    items: clone(initial.items) as Row[],
    users: clone(initial.users) as Row[],
    addresses: clone(initial.addresses) as Row[],
    refunds: [] as Row[],
    settings: initial.settings === undefined ? null : initial.settings,
    discountCodes: clone(initial.discountCodes) as Row[],
    counter: 0,
    /** Errors thrown by the next order.create calls, one per call. */
    orderCreateErrors: [] as unknown[],
    rawCalls: [] as string[],
    events: [] as string[],
  };
  let sequence = 1;

  const hydrate = (order: Row | undefined) => order && ({
    ...order,
    user: state.users.find((user) => user.id === order.userId) ?? null,
    shippingAddress: state.addresses.find((address) => address.id === order.shippingAddressId) ?? null,
    items: state.items
      .filter((item) => item.orderId === order.id)
      .map((item) => ({ ...item, product: state.products.find((product) => product.id === item.productId) })),
  });

  const withoutOmitted = (row: Row | undefined, omit: Row | undefined) => {
    if (!row || !omit) return row;
    const copy = { ...row };
    for (const [key, omitted] of Object.entries(omit)) if (omitted) delete copy[key];
    return copy;
  };

  const order = {
    findUnique: async ({ where, omit }: Row) => {
      const found = state.orders.find((row) => matches(row, where));
      return withoutOmitted(hydrate(found), omit) ?? null;
    },
    findMany: async ({ where }: Row = {}) => state.orders.filter((row) => matches(row, where)).map((row) => ({ ...row })),
    count: async ({ where }: Row = {}) => state.orders.filter((row) => matches(row, where)).length,
    create: async ({ data }: Row) => {
      if (state.orderCreateErrors.length > 0) throw state.orderCreateErrors.shift();
      const { items, ...fields } = data;
      const created = { id: cuid(`order${sequence++}`), ...ORDER_DEFAULTS, ...fields };
      state.orders.push(created);
      for (const item of items?.create ?? []) state.items.push({ id: cuid(`item${sequence++}`), orderId: created.id, ...item });
      return { ...created };
    },
    update: async ({ where, data }: Row) => {
      const found = state.orders.find((row) => matches(row, where));
      if (!found) throw new Error("Order not found");
      Object.assign(found, data);
      return { ...found };
    },
    updateMany: async ({ where, data }: Row) => {
      const found = state.orders.filter((row) => matches(row, where));
      for (const row of found) Object.assign(row, data);
      return { count: found.length };
    },
  };

  const db: Row = {
    order,
    user: { findUnique: async ({ where }: Row) => state.users.find((row) => matches(row, where)) ?? null },
    product: {
      findMany: async ({ where }: Row = {}) => state.products.filter((row) => matches(row, where)).map((row) => ({ ...row })),
      findUnique: async ({ where }: Row) => state.products.find((row) => matches(row, where)) ?? null,
      updateMany: async ({ where, data }: Row) => {
        const found = state.products.filter((row) => matches(row, where));
        for (const row of found) {
          if (data.stock?.decrement) row.stock -= data.stock.decrement;
        }
        return { count: found.length };
      },
      update: async ({ where, data }: Row) => {
        const found = state.products.find((row) => matches(row, where));
        if (!found) throw new Error("Product not found");
        if (data.stock?.increment) {
          found.stock += data.stock.increment;
          state.events.push(`restock:${found.id}`);
        }
        return { ...found };
      },
    },
    orderItem: { findMany: async ({ where }: Row) => state.items.filter((row) => matches(row, where)).map((row) => ({ ...row })) },
    address: {
      create: async ({ data }: Row) => {
        const created = { id: cuid(`address${sequence++}`), ...data };
        state.addresses.push(created);
        return created;
      },
      findMany: async ({ where }: Row) => state.addresses.filter((row) => matches(row, where)).map((row) => ({ ...row })),
      count: async ({ where }: Row) => state.addresses.filter((row) => matches(row, where)).length,
      findFirst: async ({ where }: Row) => state.addresses.find((row) => matches(row, where)) ?? null,
    },
    discountCode: { findUnique: async ({ where }: Row) => state.discountCodes.find((row) => matches(row, where)) ?? null },
    storeSettings: { findFirst: async () => state.settings },
    stripeRefund: {
      createMany: async ({ data }: Row) => {
        let count = 0;
        for (const row of data) {
          if (state.refunds.some((existing) => existing.stripeRefundId === row.stripeRefundId)) continue;
          state.refunds.push({ ...row });
          count += 1;
        }
        return { count };
      },
      updateMany: async ({ where, data }: Row) => {
        const found = state.refunds.filter((row) => matches(row, where));
        for (const row of found) Object.assign(row, data);
        return { count: found.length };
      },
      aggregate: async ({ where }: Row) => {
        const found = state.refunds.filter((row) => matches(row, where));
        if (found.length === 0) return { _sum: { amount: null, amountMinor: null } };
        return {
          _sum: {
            amount: found.reduce((sum, row) => sum + Number(row.amount), 0),
            amountMinor: found.reduce((sum, row) => sum + row.amountMinor, 0),
          },
        };
      },
    },
    // Order-number counter used by lib/order-number.ts.
    $queryRaw: async (strings: TemplateStringsArray) => {
      state.rawCalls.push(`query:${strings[0].trim().split(/\s+/).slice(0, 2).join(" ")}`);
      state.counter += 1;
      return [{ value: state.counter }];
    },
    $executeRaw: async (strings: TemplateStringsArray) => {
      state.rawCalls.push(`execute:${strings[0].trim().split(/\s+/).slice(0, 2).join(" ")}`);
      return 1;
    },
    $transaction: async (callback: (tx: Row) => Promise<unknown>) => callback(db),
  };

  return { db, state };
}
