// app/api/coupons/validate/route.ts

import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const identifier = session?.user?.id || request.headers.get("x-forwarded-for") || "127.0.0.1";

    const rateLimit = await checkRateLimit(identifier, "coupons");
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { code, orderAmount } = body;

    if (!code || !orderAmount) {
      return NextResponse.json(
        { error: "Code and amount required" },
        { status: 400 }
      );
    }

    // Use discountCode model as defined in schema
    const coupon = await db.discountCode.findUnique({
      where: { code: code.toUpperCase() },
    });

    if (!coupon || !coupon.isActive) {
      return NextResponse.json(
        { error: "Invalid coupon code" },
        { status: 404 }
      );
    }

    // Check expiry
    if (coupon.expiresAt && new Date() > coupon.expiresAt) {
      return NextResponse.json(
        { error: "Coupon has expired" },
        { status: 400 }
      );
    }

    // Note: Schema doesn't have usageLimit, minAmount, maxDiscount yet.
    // Skipping those checks for now to match current schema.

    // Calculate discount
    let discount = 0;
    if (coupon.type === "FIXED") {
      discount = coupon.value;
    } else if (coupon.type === "PERCENT") {
      discount = (orderAmount * coupon.value) / 100;
      // if (coupon.maxDiscount) ... // Not in schema
    }

    const finalAmount = Math.max(0, orderAmount - discount);

    return NextResponse.json({
      valid: true,
      discount,
      finalAmount,
      couponId: coupon.id,
      code: coupon.code,
      type: coupon.type, // "FIXED" | "PERCENT"
      value: coupon.value,
    });
  } catch (error) {
    console.error("Coupon validation error:", error);
    return NextResponse.json(
      { error: "Failed to validate coupon" },
      { status: 500 }
    );
  }
}

