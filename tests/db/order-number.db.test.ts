import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { allocateOrderNumber, formatOrderNumber, isOrderNumberConflict, resyncOrderNumberCounter } from "../../lib/order-number";
import { createTestDatabaseClient } from "./helpers";

const db = createTestDatabaseClient();
// A far-future year keeps these rows separate from any real data.
const now = new Date(Date.UTC(2999, 5, 1));
const YEAR = 2999;

async function cleanup() {
  await db.order.deleteMany({ where: { orderNumber: { startsWith: `#${YEAR}-` } } });
  await db.orderNumberCounter.deleteMany({ where: { year: YEAR } });
}

async function createOrder(orderNumber: string) {
  return db.order.create({
    data: { orderNumber, subtotal: 1, tax: 0, total: 1, shippingCost: 0, currency: "USD" },
  });
}

before(cleanup);
after(async () => {
  await cleanup();
  await db.$disconnect();
});

test("concurrent allocations never return the same order number", async () => {
  const numbers = await Promise.all(Array.from({ length: 40 }, () => allocateOrderNumber(db, now)));
  assert.equal(new Set(numbers).size, numbers.length);
  const sequences = numbers.map((number) => Number(number.split("-")[1])).sort((a, b) => a - b);
  assert.deepEqual(sequences, Array.from({ length: 40 }, (_, index) => index + 1));
});

test("a new year row continues after existing order numbers", async () => {
  await cleanup();
  await createOrder(formatOrderNumber(YEAR, 41));
  assert.equal(await allocateOrderNumber(db, now), formatOrderNumber(YEAR, 42));
});

test("resync skips numbers taken by an older release during deployment", async () => {
  await cleanup();
  assert.equal(await allocateOrderNumber(db, now), formatOrderNumber(YEAR, 1));
  // The previous release still uses "last number + 1" while the new build runs.
  await createOrder(formatOrderNumber(YEAR, 2));
  await createOrder(formatOrderNumber(YEAR, 3));

  const conflicting = await allocateOrderNumber(db, now);
  assert.equal(conflicting, formatOrderNumber(YEAR, 2));
  await assert.rejects(createOrder(conflicting), (error) => isOrderNumberConflict(error));

  await resyncOrderNumberCounter(db, now);
  assert.equal(await allocateOrderNumber(db, now), formatOrderNumber(YEAR, 4));
});
