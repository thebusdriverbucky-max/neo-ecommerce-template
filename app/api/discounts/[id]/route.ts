import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { discountSchema } from "@/lib/discounts";
import { discountApiError } from "@/lib/discount-feedback";

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();

    if (session?.user?.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const data = discountSchema.parse(await request.json());

    const discount = await db.discountCode.update({
      where: { id: params.id },
      data,
    });

    return NextResponse.json(discount);
  } catch (error) {
    const failure = discountApiError(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();

    if (session?.user?.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await db.discountCode.delete({
      where: { id: params.id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const failure = discountApiError(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
