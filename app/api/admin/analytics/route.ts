// app/api/admin/analytics/route.ts

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (session?.user?.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const rateLimit = await checkRateLimit(session.user.id!, "admin");
    if (!rateLimit.success) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    // Total revenue
    const orders = await db.order.findMany({
      where: { status: "CONFIRMED" },
    });

    const totalRevenue = orders.reduce(
      (sum, order) => sum + parseFloat(order.total.toString()),
      0
    );

    // Total orders
    const totalOrders = await db.order.count();

    // Orders by status
    const pendingOrders = await db.order.count({
      where: { status: "PENDING" },
    });

    const confirmedOrders = await db.order.count({
      where: { status: "CONFIRMED" },
    });

    // Average order value
    const avgOrderValue = totalOrders > 0 ? totalRevenue / confirmedOrders : 0;

    // Revenue over time (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentOrdersCount = await db.order.count({
      where: {
        createdAt: { gte: thirtyDaysAgo },
      },
    });

    const totalProducts = await db.product.count({
      where: { isArchived: false },
    });

    const recentOrdersData = await db.order.groupBy({
      by: ["createdAt"],
      where: {
        status: "CONFIRMED",
        createdAt: { gte: thirtyDaysAgo },
      },
      _sum: { total: true },
      _count: true,
    });

    // Format revenue by date
    const revenueByDate = recentOrdersData.reduce((acc: any, order) => {
      const date = new Date(order.createdAt).toLocaleDateString();
      if (!acc[date]) {
        acc[date] = 0;
      }
      acc[date] += parseFloat(order._sum.total?.toString() || "0");
      return acc;
    }, {});

    return NextResponse.json({
      totalRevenue: parseFloat(totalRevenue.toFixed(2)),
      totalOrders,
      avgOrderValue: parseFloat(avgOrderValue.toFixed(2)),
      pendingOrders,
      confirmedOrders,
      revenueByDate,
      totalProducts,
      recentOrders: recentOrdersCount,
    });
  } catch (error) {
    console.error("Analytics error:", error);
    return NextResponse.json(
      { error: "Failed to fetch analytics" },
      { status: 500 }
    );
  }
}
