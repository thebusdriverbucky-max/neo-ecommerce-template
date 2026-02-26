import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();

    if (session?.user?.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    let expiresAt = null;
    if (body.expiresAt) {
      expiresAt = new Date(body.expiresAt);
      // Fix for 2-digit years being interpreted as 19xx or 00xx
      // If the year is less than 100, assume it's 20xx
      if (expiresAt.getFullYear() < 100) {
        expiresAt.setFullYear(expiresAt.getFullYear() + 2000);
      }
    }

    const discount = await db.discountCode.update({
      where: { id: params.id },
      data: {
        code: body.code,
        type: body.type,
        value: body.value,
        expiresAt,
        isActive: body.isActive,
      },
    });

    return NextResponse.json(discount);
  } catch (error) {
    console.error("Discount update error:", error);
    return NextResponse.json(
      { error: "Failed to update discount" },
      { status: 500 }
    );
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
    console.error("Discount deletion error:", error);
    return NextResponse.json(
      { error: "Failed to delete discount" },
      { status: 500 }
    );
  }
}
