import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createOrderCheckout } from "@/lib/create-order-checkout";
import { parseOrderListQuery } from "@/lib/admin-orders";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return createOrderCheckout(request);
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const query = parseOrderListQuery(new URL(request.url).searchParams);
    if (!query.ok) {
      return NextResponse.json({ error: query.error }, { status: 400 });
    }

    const args = {
      where: query.where as Prisma.OrderWhereInput,
      // Hashes are only used server side; the admin screen never needs them.
      omit: { guestAccessTokenHash: true, checkoutIpHash: true },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        shippingAddress: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            street: true,
            city: true,
            state: true,
            postalCode: true,
            country: true,
          },
        },
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                price: true,
                image: true,
              },
            },
          },
        },
      },
      // id breaks ties so pages never repeat or skip orders created together.
      orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    };

    // Without ?page the legacy array response is kept for older callers.
    if (!query.paginated) {
      return NextResponse.json(await db.order.findMany(args));
    }

    const [total, orders] = await Promise.all([
      db.order.count({ where: query.where as Prisma.OrderWhereInput }),
      db.order.findMany({ ...args, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    ]);

    return NextResponse.json({ orders, total, page: query.page, pageSize: query.pageSize });
  } catch (error) {
    console.error("Error fetching orders:", error);
    return NextResponse.json({ error: "Failed to fetch orders" }, { status: 500 });
  }
}
