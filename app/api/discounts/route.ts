import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { discountSchema } from "@/lib/discounts";
import { discountApiError } from "@/lib/discount-feedback";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (session?.user?.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const discounts = await db.discountCode.findMany({
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(discounts);
  } catch (error) {
    console.error("Discounts API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch discounts" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (session?.user?.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    const data = discountSchema.parse(body);

    const discount = await db.discountCode.create({
      data,
    });

    return NextResponse.json(discount, { status: 201 });
  } catch (error) {
    const failure = discountApiError(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
