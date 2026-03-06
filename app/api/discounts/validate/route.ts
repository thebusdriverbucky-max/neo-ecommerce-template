import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const identifier = session?.user?.id || request.headers.get("x-forwarded-for") || "127.0.0.1";

    const rateLimit = await checkRateLimit(identifier, "coupons"); // Using same limit as coupons
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }

    const { code } = await request.json();

    if (!code) {
      return NextResponse.json(
        { error: "Code is required" },
        { status: 400 }
      );
    }

    const discount = await db.discountCode.findUnique({
      where: { code: code.toUpperCase() },
    });

    if (!discount) {
      return NextResponse.json(
        { error: "Invalid discount code" },
        { status: 404 }
      );
    }

    if (!discount.isActive) {
      return NextResponse.json(
        { error: "Discount code is inactive" },
        { status: 400 }
      );
    }

    if (discount.expiresAt) {
      const expirationDate = new Date(discount.expiresAt);
      // Устанавливаем время истечения на конец дня (23:59:59.999)
      expirationDate.setHours(23, 59, 59, 999);

      const now = new Date();

      // Check if the discount code has expired
      // We compare timestamps to ensure accurate comparison regardless of timezones
      if (expirationDate.getTime() < now.getTime()) {
        return NextResponse.json(
          { error: "Discount code has expired" },
          { status: 400 }
        );
      }
    }

    return NextResponse.json({
      code: discount.code,
      type: discount.type,
      value: discount.value,
    });
  } catch (error) {
    console.error("Discount validation error:", error);
    return NextResponse.json(
      { error: "Failed to validate discount" },
      { status: 500 }
    );
  }
}

