import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import React from "react";
import { act } from "react-dom/test-utils";
import { renderToStaticMarkup } from "react-dom/server";
import { averageOrderValue, buildDailyRevenue, PAID_ORDER_STATUSES } from "../lib/admin-analytics";
import { moduleLoader } from "./helpers/load-module";

const dec = (value: string) => ({ toString: () => value });

function analyticsRoute(options: {
  role?: string;
  currency?: string | null;
  sum?: string | null;
  count?: number;
  other?: number;
  groups?: Array<{ status: string; _count: { _all: number } }>;
  daily?: any[];
  rateLimit?: { success: boolean; unavailable?: boolean };
  fail?: boolean;
}, calls: any[] = []) {
  const load = moduleLoader({
    "@/lib/auth": { auth: async () => ({ user: { id: "admin-1", role: options.role ?? "ADMIN" } }) },
    "@/lib/rate-limit": { checkRateLimit: async () => options.rateLimit ?? { success: true } },
    "@/lib/db": {
      db: {
        storeSettings: {
          findFirst: async (args: any) => {
            calls.push(["settings", args]);
            if (options.fail) throw new Error("db down");
            return options.currency === null ? null : { currency: options.currency ?? "EUR" };
          },
        },
        order: {
          aggregate: async (args: any) => { calls.push(["aggregate", args]); return { _sum: { total: options.sum ?? null }, _count: { _all: options.count ?? 0 } }; },
          count: async (args: any) => { calls.push(["count", args]); return args.where.currency ? options.other ?? 0 : 7; },
          groupBy: async (args: any) => { calls.push(["groupBy", args]); return options.groups ?? []; },
        },
        product: { count: async () => 12 },
        $queryRaw: async (...args: any[]) => { calls.push(["raw", args]); return options.daily ?? []; },
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

test("revenue counts shipped and delivered orders, excludes unpaid and refunded ones, Lite orders only", async () => {
  assert.deepEqual([...PAID_ORDER_STATUSES], ["CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED"]);
  const calls: any[] = [];
  const route = analyticsRoute({
    currency: "eur",
    sum: "1200.50",
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

  const settingsRead = calls.find(([name]) => name === "settings")![1];
  assert.deepEqual(settingsRead.orderBy, [{ createdAt: "asc" }, { id: "asc" }]);

  const aggregate = calls.find(([name]) => name === "aggregate")![1];
  assert.deepEqual(aggregate.where.status.in, ["CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED"]);
  for (const status of ["PENDING", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED"]) assert.ok(!aggregate.where.status.in.includes(status));
  assert.equal(aggregate.where.currency, "EUR");
  assert.deepEqual(aggregate.where.reservationExpiresAt, { not: null });
  assert.deepEqual(calls.find(([name]) => name === "groupBy")![1].where, { reservationExpiresAt: { not: null } });
  for (const [name, args] of calls) {
    if (name === "count" && args.where.createdAt) assert.deepEqual(args.where.reservationExpiresAt, { not: null });
  }
  const other = calls.find(([name, args]) => name === "count" && args.where.currency?.not)![1];
  assert.equal(other.where.currency.not, "EUR");

  // Aggregates and the daily series run in SQL, restricted to Lite orders.
  const raw = calls.find(([name]) => name === "raw")![1];
  const sql = raw[0].join("?");
  assert.match(sql, /"reservationExpiresAt" IS NOT NULL/);
  assert.match(sql, /GROUP BY/);

  assert.equal(body.currency, "EUR");
  assert.equal(body.totalRevenue, 1200.5);
  assert.equal(body.paidOrders, 4);
  assert.equal(body.avgOrderValue, 300.13);
  assert.equal(body.otherCurrencyPaidOrders, 2);
  assert.equal(body.totalOrders, 7);
  assert.deepEqual(body.ordersByStatus, { PENDING: 3, CONFIRMED: 1, SHIPPED: 2, REFUNDED: 1 });
  assert.equal(body.pendingOrders, 3);
  assert.equal(body.confirmedOrders, 1);
  assert.equal(body.totalProducts, 12);
  assert.equal(body.recentOrders, 7);
});

test("average order value divides by paid orders and never yields NaN", async () => {
  // Orders exist but none is paid: the old code divided 0 by 0 confirmed orders.
  const body = await (await call(analyticsRoute({
    currency: null, count: 0, sum: null, groups: [{ status: "PENDING", _count: { _all: 5 } }],
  }))).json();
  assert.equal(body.currency, "USD");
  assert.equal(body.totalOrders, 5);
  assert.equal(body.avgOrderValue, 0);
  assert.equal(body.totalRevenue, 0);
  assert.equal(body.paidOrders, 0);
  assert.equal(body.dailyRevenue.length, 30);
  assert.ok(body.dailyRevenue.every((entry: any) => entry.revenue === 0));
  assert.equal(averageOrderValue(100, 0), 0);
  assert.equal(averageOrderValue(100, 3), 33.33);
  assert.ok(Object.values(body).every(value => typeof value !== "number" || Number.isFinite(value)));
});

test("a failing query returns a generic 500 without leaking details", async () => {
  const response = await call(analyticsRoute({ fail: true }));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Failed to fetch analytics" });
});

test("daily revenue is bucketed by UTC date, filled and sorted", () => {
  const now = new Date("2026-03-02T00:30:00.000Z");
  const days = buildDailyRevenue([
    { day: "2026-03-01", total: dec("100.10") },
    { day: "2026-02-27", total: dec("50") },
    { day: "2026-03-02", total: dec("20") },
    // Outside the window: must be ignored.
    { day: "2025-12-01", total: dec("999") },
  ], now);
  assert.equal(days.length, 30);
  assert.equal(days[0].date, "2026-02-01");
  assert.equal(days[29].date, "2026-03-02");
  assert.deepEqual(days.map(entry => entry.date), [...days.map(entry => entry.date)].sort());
  const byDate = Object.fromEntries(days.map(entry => [entry.date, entry.revenue]));
  assert.equal(byDate["2026-03-01"], 100.1);
  assert.equal(byDate["2026-02-27"], 50);
  assert.equal(byDate["2026-03-02"], 20);
  assert.equal(byDate["2026-02-28"], 0);
});

async function withDom(run: (dom: any) => Promise<void>, fetchImpl: (...args: any[]) => Promise<Response>) {
  const { JSDOM } = createRequire(import.meta.url)("jsdom");
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true, fetch: fetchImpl,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  try {
    await run(dom);
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
}

test("analytics page waits for the session, checks response.ok and formats the store currency", async () => {
  const redirects: string[] = [];
  let session: { data: any; status: string } = { data: null, status: "loading" };
  let analyticsResponse = () => Response.json({ error: "Too many requests" }, { status: 429 });
  let fetches = 0;
  await withDom(async (dom) => {
    const stub = (name: string) => function Chart({ children }: any) { return React.createElement("div", { "data-chart": name }, children); };
    const load = moduleLoader({
      "next-auth/react": { useSession: () => session },
      "next/navigation": { redirect: (path: string) => { redirects.push(path); throw new Error("NEXT_REDIRECT"); } },
      recharts: Object.fromEntries(
        ["LineChart", "Line", "XAxis", "YAxis", "CartesianGrid", "Tooltip", "ResponsiveContainer", "BarChart", "Bar"]
          .map(name => [name, stub(name)]),
      ),
    });
    const Page = load("app/(dashboard)/admin/analytics/page.tsx").default;
    const { createRoot } = await import("react-dom/client");
    const container = dom.window.document.getElementById("root")!;
    const root = createRoot(container);
    try {
      // Still loading: an admin must not be bounced to the home page.
      await act(async () => { root.render(React.createElement(Page)); });
      assert.deepEqual(redirects, []);
      assert.match(container.textContent!, /Loading/);

      // A failed response shows an error instead of crashing on a missing body shape.
      session = { data: { user: { role: "ADMIN" } }, status: "authenticated" };
      await act(async () => { root.render(React.createElement(Page)); });
      assert.match(container.textContent!, /Too many requests/);
      assert.match(container.textContent!, /Try again/);
      assert.doesNotMatch(container.textContent!, /Total Revenue/);

      analyticsResponse = () => Response.json({
        currency: "EUR", totalRevenue: 1234.5, paidOrders: 2, avgOrderValue: 617.25, otherCurrencyPaidOrders: 0,
        ordersByStatus: { PENDING: 3, SHIPPED: 2 }, dailyRevenue: [{ date: "2026-03-01", revenue: 10 }],
        totalOrders: 5, recentOrders: 5, totalProducts: 4,
      });
      const retry = Array.from<HTMLButtonElement>(container.querySelectorAll("button")).find(el => el.textContent === "Try again")!;
      await act(async () => { retry.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
      const text = container.textContent!;
      assert.match(text, /1,234\.50€/);
      assert.doesNotMatch(text, /\$/);
      assert.match(text, /Awaiting Payment/);
      assert.match(text, /Pending/);
      assert.match(text, /Shipped/);
      assert.equal(fetches, 2);

      // A signed-in non-admin is redirected once the status is known.
      session = { data: { user: { role: "CUSTOMER" } }, status: "authenticated" };
      await assert.rejects(async () => { await act(async () => { root.render(React.createElement(Page)); }); }, /NEXT_REDIRECT/);
      // React retries a throwing render, so more than one attempt is expected.
      assert.ok(redirects.length > 0 && redirects.every(path => path === "/"));
    } finally {
      try { await act(async () => root.unmount()); } catch { /* the last render threw on purpose */ }
    }
  }, async () => { fetches++; return analyticsResponse(); });
});

test("admin dashboard counts awaiting-payment orders, lists Lite orders only and names guests", async () => {
  const calls: any[] = [];
  const base = { total: 20, currency: "EUR", shippingAddress: null, user: null, guestEmail: null };
  const orders = [
    { ...base, id: "o1aaaaaaaa", orderNumber: "A-1", status: "PENDING", guestEmail: "guest@example.test" },
    { ...base, id: "o2bbbbbbbb", orderNumber: "A-2", status: "SHIPPED", shippingAddress: { firstName: "Ada", lastName: "Lovelace" } },
    { ...base, id: "o3cccccccc", orderNumber: "A-3", status: "CONFIRMED", user: { name: null, email: "member@example.test" } },
    { ...base, id: "o4dddddddd", orderNumber: "A-4", status: "DELIVERED" },
  ];
  const load = moduleLoader({
    "@/lib/auth": { auth: async () => ({ user: { role: "ADMIN" } }) },
    "next/navigation": { redirect() { throw new Error("unexpected redirect"); } },
    "next/link": { __esModule: true, default: ({ href, children }: any) => React.createElement("a", { href }, children) },
    "@/lib/db": { db: {
      storeSettings: { findFirst: async (args: any) => { calls.push(["settings", args]); return { currency: "EUR" }; } },
      order: {
        count: async (args: any) => { calls.push(["count", args]); return 3; },
        findMany: async (args: any) => { calls.push(["orders", args]); return orders; },
      },
      product: { findMany: async () => [] },
    } },
  });
  const element = await load("app/(dashboard)/admin/page.tsx").default();
  const html = renderToStaticMarkup(element);

  assert.deepEqual(calls.find(([name]) => name === "settings")![1].orderBy, [{ createdAt: "asc" }, { id: "asc" }]);
  const count = calls.find(([name]) => name === "count")![1];
  assert.deepEqual(count.where, { reservationExpiresAt: { not: null }, status: "PENDING" });
  assert.deepEqual(calls.find(([name]) => name === "orders")![1].where, { reservationExpiresAt: { not: null } });
  assert.match(html, /Awaiting payment/);
  assert.match(html, /data-testid="awaiting-payment-count">3</);
  assert.match(html, /20\.00€/);

  // Customer fallbacks: guest email, address name, account email, then "Guest".
  for (const name of ["guest@example.test", "Ada Lovelace", "member@example.test", "Guest"]) assert.ok(html.includes(`>${name}<`), name);
  assert.ok(!html.includes("null"), "no stray null/undefined in names");
  assert.ok(!html.includes("undefined"));

  // PENDING has its own badge colour, distinct from active orders.
  const badge = (status: string) => html.match(new RegExp(`class="([^"]*)">${status}<`))![1];
  assert.notEqual(badge("PENDING"), badge("SHIPPED"));
  assert.equal(badge("SHIPPED"), badge("CONFIRMED"));
});
