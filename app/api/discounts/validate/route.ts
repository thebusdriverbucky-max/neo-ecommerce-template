import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getTrustedClientIdentifier } from "@/lib/request-identity";
import { discountAvailabilityError, discountLookupSchema, publicDiscount } from "@/lib/discounts";
import { discountApiError } from "@/lib/discount-feedback";

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

    const { code, orderAmount } = discountLookupSchema.parse(await request.json());

    const discount = await db.discountCode.findUnique({
      where: { code },
    });

    if (!discount) {
      return NextResponse.json(
        { error: "Invalid discount code" },
        { status: 404 }
      );
    }

    const error = discountAvailabilityError(discount, new Date(), orderAmount);
    if (error) return NextResponse.json({ error }, { status: 400 });
    return NextResponse.json(publicDiscount(discount));
  } catch (error) {
    const failure = discountApiError(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
