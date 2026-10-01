import { z } from "zod";
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getTrustedClientIdentifier } from "@/lib/request-identity";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const identifier = session?.user?.id || getTrustedClientIdentifier(request);

    const rateLimit = await checkRateLimit(identifier, "coupons"); // Using same limit as coupons
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: rateLimit.unavailable ? "Discount protection is temporarily unavailable. Please try again shortly." : "Too many requests. Please try again later." },
        { status: rateLimit.unavailable ? 503 : 429 }
      );
    }

    const { code } = z.object({ code: z.string().trim().min(1).max(50) }).parse(await request.json());

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
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    console.error("Discount validation error:", error);
    return NextResponse.json(
      { error: "Failed to validate discount" },
      { status: 500 }
    );
  }
}
