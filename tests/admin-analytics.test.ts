import assert from "node:assert/strict";
import test from "node:test";
import { moduleLoader } from "./helpers/load-module";
import { averageOrderValue, buildDailyRevenue, PAID_ORDER_STATUSES } from "../lib/admin-analytics";

const dec = (value: string) => ({ toString: () => value });

function analyticsRoute(options: {
  role?: string;
  currency?: string | null;
  sum?: { total: string | null; refundedAmount: string | null };
  count?: number;
  other?: number;
  groups?: Array<{ status: string; _count: { _all: number } }>;
  daily?: any[];
  rateLimit?: { success: boolean; unavailable?: boolean };
}, calls: any[] = []) {
  const load = moduleLoader({
    "@/lib/auth": { auth: async () => ({ user: { id: "admin-1", role: options.role ?? "ADMIN" } }) },
    "@/lib/rate-limit": { checkRateLimit: async () => options.rateLimit ?? { success: true } },
    "@/lib/db": {
      db: {
        storeSettings: { findFirst: async () => (options.currency === null ? null : { currency: options.currency ?? "EUR" }) },
        order: {
          aggregate: async (args: any) => {
            calls.push(["aggregate", args]);
            return { _sum: options.sum ?? { total: null, refundedAmount: null }, _count: { _all: options.count ?? 0 } };
          },
          count: async (args: any) => {
            calls.push(["count", args]);
            return args.where.currency ? options.other ?? 0 : 7;
          },
          groupBy: async () => options.groups ?? [],
        },
        product: { count: async () => 12 },
        $queryRaw: async (...args: any[]) => {
          calls.push(["raw", args]);
          return options.daily ?? [];
        },
      },
    },
  });
  return load("app/api/admin/analytics/route.ts");
}

const call = (route: any) => route.GET(new Request("http://localhost/api/admin/analytics"));

test("analytics rejects non-admins and honours the rate limit", async () => {
  assert.equal((await call(analyticsRoute({ role: "CUSTOMER" }))).status, 403);
  assert.equal((await call(analyticsRoute({ rateLimit: { success: false } }))).status, 429);
  assert.equal((await call(analyticsRoute({ rateLimit: { success: false, unavailable: true } }))).status, 503);
});

test("analytics counts every paid status, subtracts refunds and stays in the store currency", async () => {
  const calls: any[] = [];
  const route = analyticsRoute({
    currency: "eur",
    sum: { total: "1200.50", refundedAmount: "200.25" },
    count: 4,
    other: 2,
    groups: [
      { status: "PENDING", _count: { _all: 3 } },
      { status: "CONFIRMED", _count: { _all: 1 } },
      { status: "SHIPPED", _count: { _all: 2 } },
      { status: "REFUNDED", _count: { _all: 1 } },
    ],
  }, calls);
  const body = await (await call(route)).json();

  const aggregate = calls.find(([name]) => name === "aggregate")![1];
  assert.deepEqual(aggregate.where.status.in, [...PAID_ORDER_STATUSES]);
  assert.deepEqual([...PAID_ORDER_STATUSES], ["CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "PARTIALLY_REFUNDED", "REFUNDED"]);
  assert.equal(aggregate.where.currency, "EUR");
  const other = calls.find(([name, args]) => name === "count" && args.where.currency?.not)![1];
  assert.equal(other.where.currency.not, "EUR");

  assert.equal(body.currency, "EUR");
  assert.equal(body.grossSales, 1200.5);
  assert.equal(body.refunds, 200.25);
  assert.equal(body.netRevenue, 1000.25);
  assert.equal(body.paidOrders, 4);
  assert.equal(body.avgOrderValue, 300.13);
  assert.equal(body.otherCurrencyPaidOrders, 2);
  assert.equal(body.totalOrders, 7);
  assert.deepEqual(body.ordersByStatus, { PENDING: 3, CONFIRMED: 1, SHIPPED: 2, REFUNDED: 1 });
  assert.equal(body.pendingOrders, 3);
  assert.equal(body.confirmedOrders, 1);
  assert.equal(body.totalRevenue, body.netRevenue);
  assert.equal(body.totalProducts, 12);
  assert.equal(body.recentOrders, 7);
});

test("analytics with no paid orders reports zeros instead of NaN", async () => {
  const body = await (await call(analyticsRoute({ currency: null }))).json();
  assert.equal(body.currency, "USD");
  for (const key of ["grossSales", "refunds", "netRevenue", "paidOrders", "avgOrderValue", "otherCurrencyPaidOrders"]) {
    assert.equal(body[key], 0, key);
  }
  assert.equal(body.dailyRevenue.length, 30);
  assert.ok(body.dailyRevenue.every((entry: any) => entry.revenue === 0));
});

test("daily revenue is bucketed by UTC date, net of refunds, filled and sorted", () => {
  const now = new Date("2026-03-02T00:30:00.000Z");
  const days = buildDailyRevenue([
    { day: "2026-03-01", gross: dec("100.10"), refunded: dec("0.10") },
    { day: "2026-02-27", gross: dec("50"), refunded: dec("60") },
    { day: "2026-03-02", gross: dec("20"), refunded: null },
    // Outside the window: must be ignored.
    { day: "2025-12-01", gross: dec("999"), refunded: dec("0") },
  ], now);
  assert.equal(days.length, 30);
  assert.equal(days[0].date, "2026-02-01");
  assert.equal(days[29].date, "2026-03-02");
  assert.deepEqual(days.map(entry => entry.date), [...days.map(entry => entry.date)].sort());
  const byDate = Object.fromEntries(days.map(entry => [entry.date, entry.revenue]));
  assert.equal(byDate["2026-03-01"], 100);
  assert.equal(byDate["2026-02-27"], -10);
  assert.equal(byDate["2026-03-02"], 20);
  assert.equal(byDate["2026-02-28"], 0);
  assert.equal(averageOrderValue(100, 0), 0);
  assert.equal(averageOrderValue(100, 3), 33.33);
});
