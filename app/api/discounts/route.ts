import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { z } from "zod";

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

    // Validate admin input
    const discountSchema = z.object({
      code: z.string().min(2).max(50),
      type: z.enum(["FIXED", "PERCENT"]),
      value: z.number().positive(),
      isActive: z.boolean().optional().default(true),
      expiresAt: z.string().datetime().optional().nullable(),
    });

    const parsed = discountSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const data = parsed.data;

    let expiresAt: Date | null = null;
    if (data.expiresAt) {
      expiresAt = new Date(data.expiresAt);
      // Fix for 2-digit years being interpreted as 19xx or 00xx
      // If the year is less than 100, assume it's 20xx
      if (expiresAt.getFullYear() < 100) {
        expiresAt.setFullYear(expiresAt.getFullYear() + 2000);
      }
    }

    const discount = await db.discountCode.create({
      data: {
        code: data.code.toUpperCase(),
        type: data.type,
        value: data.value,
        expiresAt,
        isActive: data.isActive,
      },
    });

    return NextResponse.json(discount, { status: 201 });
  } catch (error) {
    console.error("Discount creation error:", error);
    return NextResponse.json(
      { error: "Failed to create discount" },
      { status: 500 }
    );
  }
}
