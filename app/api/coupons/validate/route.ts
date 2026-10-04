// app/api/coupons/validate/route.ts

import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getTrustedClientIdentifier } from "@/lib/request-identity";
import { calculateDiscountAmount, couponLookupSchema, discountAvailabilityError, publicDiscount, moneyDecimals } from "@/lib/discounts";
import { discountApiError } from "@/lib/discount-feedback";
import Decimal from "decimal.js";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const identifier = session?.user?.id || getTrustedClientIdentifier(request);

    const rateLimit = await checkRateLimit(identifier, "coupons");
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: rateLimit.unavailable ? "Coupon protection is temporarily unavailable. Please try again shortly." : "Too many requests. Please try again later." },
        { status: rateLimit.unavailable ? 503 : 429 }
      );
    }

    const { code, orderAmount } = couponLookupSchema.parse(await request.json());

    // Use discountCode model as defined in schema
    const coupon = await db.discountCode.findUnique({
      where: { code },
    });

    if (!coupon) {
      return NextResponse.json(
        { error: "Invalid coupon code" },
        { status: 404 }
      );
    }

    const error = discountAvailabilityError(coupon, new Date(), orderAmount);
    if (error) return NextResponse.json({ error }, { status: 400 });
    const settings = await db.storeSettings.findFirst();
    const currency = settings?.currency || "USD";
    const discount = calculateDiscountAmount(orderAmount, coupon, currency);
    const finalAmount = new Decimal(orderAmount).toDecimalPlaces(moneyDecimals(currency), Decimal.ROUND_HALF_UP).sub(discount).toNumber();

    return NextResponse.json({
      valid: true,
      discount,
      finalAmount,
      couponId: coupon.id,
      ...publicDiscount(coupon),
    });
  } catch (error) {
    const failure = discountApiError(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
