// app/api/admin/analytics/route.ts

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { getStoreSettings } from "@/lib/store-settings";
import {
  PAID_ORDER_STATUSES,
  analyticsWindowStart,
  averageOrderValue,
  buildDailyRevenue,
  toMoney,
  type DailyRow,
} from "@/lib/admin-analytics";

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (session?.user?.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const rateLimit = await checkRateLimit(session.user.id!, "admin");
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: rateLimit.unavailable ? "Admin protection is temporarily unavailable" : "Too many requests" },
        { status: rateLimit.unavailable ? 503 : 429 },
      );
    }

    const settings = await getStoreSettings(db);
    const currency = (settings?.currency || "USD").toUpperCase();
    const paidStatuses = [...PAID_ORDER_STATUSES];

    const now = new Date();
    const windowStart = analyticsWindowStart(now);

    const [paidTotals, otherCurrencyPaidOrders, statusGroups, recentOrders, totalProducts, dailyRows] =
      await Promise.all([
        // Money is only summed within the store currency; mixing currencies
        // would produce a meaningless number.
        db.order.aggregate({
          where: { status: { in: paidStatuses }, currency },
          _sum: { total: true, refundedAmount: true },
          _count: { _all: true },
        }),
        db.order.count({ where: { status: { in: paidStatuses }, currency: { not: currency } } }),
        db.order.groupBy({ by: ["status"], _count: { _all: true } }),
        db.order.count({ where: { createdAt: { gte: windowStart } } }),
        db.product.count({ where: { isArchived: false } }),
        // Bucketed by UTC date in the database; refunds are attributed to the
        // day the order was placed.
        db.$queryRaw<DailyRow[]>`
          -- Prisma stores DateTime as a UTC timestamp without time zone; format
          -- it directly so the bucket never depends on the session TimeZone.
          SELECT to_char("createdAt", 'YYYY-MM-DD') AS day,
                 SUM("total") AS gross,
                 SUM("refundedAmount") AS refunded
          FROM "Order"
          WHERE "status"::text = ANY(${paidStatuses})
            AND "currency" = ${currency}
            AND "createdAt" >= ${windowStart}
          GROUP BY 1
          ORDER BY 1
        `,
      ]);

    const grossSales = toMoney(paidTotals._sum.total);
    const refunds = toMoney(paidTotals._sum.refundedAmount);
    const netRevenue = Math.round((grossSales - refunds) * 100) / 100;
    const paidOrders = paidTotals._count._all;
    const avgOrderValue = averageOrderValue(grossSales, paidOrders);

    const ordersByStatus: Record<string, number> = {};
    let totalOrders = 0;
    for (const group of statusGroups) {
      ordersByStatus[group.status] = group._count._all;
      totalOrders += group._count._all;
    }

    const dailyRevenue = buildDailyRevenue(dailyRows, now);
    const revenueByDate = Object.fromEntries(dailyRevenue.map((entry) => [entry.date, entry.revenue]));

    return NextResponse.json({
      currency,
      grossSales,
      refunds,
      netRevenue,
      paidOrders,
      avgOrderValue,
      otherCurrencyPaidOrders,
      ordersByStatus,
      dailyRevenue,
      recentOrders,
      totalOrders,
      totalProducts,
      // Legacy fields kept for older callers.
      totalRevenue: netRevenue,
      pendingOrders: ordersByStatus.PENDING ?? 0,
      confirmedOrders: ordersByStatus.CONFIRMED ?? 0,
      revenueByDate,
    });
  } catch (error) {
    console.error("Analytics error:", error);
    return NextResponse.json(
      { error: "Failed to fetch analytics" },
      { status: 500 }
    );
  }
}
