// app/api/admin/analytics/route.ts

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { getStoreSettings } from "@/lib/store-settings";
import { logger } from "@/lib/logger";
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
    // Lite orders always carry a reservation; this matches the admin order list
    // and keeps rows written by the Full edition on a shared database out.
    const liteOrders = { reservationExpiresAt: { not: null } };

    const now = new Date();
    const windowStart = analyticsWindowStart(now);

    const [paidTotals, otherCurrencyPaidOrders, statusGroups, recentOrders, totalProducts, dailyRows] =
      await Promise.all([
        // Money is only summed within the store currency; mixing currencies
        // would produce a meaningless number.
        db.order.aggregate({
          where: { ...liteOrders, status: { in: paidStatuses }, currency },
          _sum: { total: true },
          _count: { _all: true },
        }),
        db.order.count({ where: { ...liteOrders, status: { in: paidStatuses }, currency: { not: currency } } }),
        db.order.groupBy({ by: ["status"], where: liteOrders, _count: { _all: true } }),
        db.order.count({ where: { ...liteOrders, createdAt: { gte: windowStart } } }),
        db.product.count({ where: { isArchived: false } }),
        // Bucketed by UTC date in the database.
        db.$queryRaw<DailyRow[]>`
          -- Prisma stores DateTime as a UTC timestamp without time zone; format
          -- it directly so the bucket never depends on the session TimeZone.
          SELECT to_char("createdAt", 'YYYY-MM-DD') AS day,
                 SUM("total") AS total
          FROM "Order"
          WHERE "reservationExpiresAt" IS NOT NULL
            AND "status"::text = ANY(${paidStatuses})
            AND "currency" = ${currency}
            AND "createdAt" >= ${windowStart}
          GROUP BY 1
          ORDER BY 1
        `,
      ]);

    const totalRevenue = toMoney(paidTotals._sum.total);
    const paidOrders = paidTotals._count._all;
    const avgOrderValue = averageOrderValue(totalRevenue, paidOrders);

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
      totalRevenue,
      paidOrders,
      avgOrderValue,
      otherCurrencyPaidOrders,
      ordersByStatus,
      dailyRevenue,
      recentOrders,
      totalOrders,
      totalProducts,
      pendingOrders: ordersByStatus.PENDING ?? 0,
      confirmedOrders: ordersByStatus.CONFIRMED ?? 0,
      revenueByDate,
    });
  } catch (error) {
    logger.error("Analytics error");
    return NextResponse.json(
      { error: "Failed to fetch analytics" },
      { status: 500 }
    );
  }
}
