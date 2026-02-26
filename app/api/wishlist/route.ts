import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = await checkRateLimit(session.user.id, "wishlist");
    if (!rateLimit.success) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const wishlist = await db.wishlist.findMany({
      where: {
        userId: session.user.id,
      },
      include: {
        product: true,
      },
    });

    return NextResponse.json(wishlist);
  } catch (error) {
    console.error("Wishlist GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch wishlist" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = await checkRateLimit(session.user.id, "wishlist");
    if (!rateLimit.success) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const body = await request.json();
    const { productId } = body;

    if (!productId) {
      return NextResponse.json(
        { error: "Product ID is required" },
        { status: 400 }
      );
    }

    const existingItem = await db.wishlist.findUnique({
      where: {
        userId_productId: {
          userId: session.user.id,
          productId,
        },
      },
    });

    if (existingItem) {
      return NextResponse.json(existingItem, { status: 200 });
    }

    const wishlistItem = await db.wishlist.create({
      data: {
        userId: session.user.id,
        productId,
      },
    });

    return NextResponse.json(wishlistItem, { status: 201 });
  } catch (error) {
    console.error("Wishlist POST error:", error);
    return NextResponse.json(
      { error: "Failed to add to wishlist" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = await checkRateLimit(session.user.id, "wishlist");
    if (!rateLimit.success) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const body = await request.json();
    const { productId } = body;

    if (!productId) {
      return NextResponse.json(
        { error: "Product ID is required" },
        { status: 400 }
      );
    }

    await db.wishlist.deleteMany({
      where: {
        userId: session.user.id,
        productId,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Wishlist DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to remove from wishlist" },
      { status: 500 }
    );
  }
}
