import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const reviews = await db.review.findMany({
      where: {
        productId: params.id,
      },
      include: {
        user: {
          select: {
            name: true,
            image: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json(reviews);
  } catch (error) {
    console.error("[REVIEWS_GET]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const rateLimit = await checkRateLimit(session.user.id!, "reviews");
    if (!rateLimit.success) {
      return new NextResponse("Too Many Requests", { status: 429 });
    }

    const body = await req.json();
    const { rating, comment } = body;

    if (!rating || !comment) {
      return new NextResponse("Missing required fields", { status: 400 });
    }

    const review = await db.review.create({
      data: {
        rating,
        comment,
        productId: params.id,
        userId: session.user.id!,
      },
    });

    // Update product rating
    const reviews = await db.review.findMany({
      where: {
        productId: params.id,
      },
    });

    const totalRating = reviews.reduce((acc: number, review: any) => acc + review.rating, 0);
    const averageRating = totalRating / reviews.length;

    await db.product.update({
      where: {
        id: params.id,
      },
      data: {
        rating: averageRating,
      },
    });

    return NextResponse.json(review);
  } catch (error) {
    console.error("[REVIEWS_POST]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();

    if (!session?.user || session.user.role !== "ADMIN") {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const reviewId = searchParams.get("reviewId");

    if (!reviewId) {
      return new NextResponse("Review ID is required", { status: 400 });
    }

    await db.review.delete({
      where: {
        id: reviewId,
      },
    });

    // Update product rating
    const reviews = await db.review.findMany({
      where: {
        productId: params.id,
      },
    });

    const totalRating = reviews.reduce((acc: number, review: any) => acc + review.rating, 0);
    const averageRating = reviews.length > 0 ? totalRating / reviews.length : 0;

    await db.product.update({
      where: {
        id: params.id,
      },
      data: {
        rating: averageRating,
      },
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("[REVIEWS_DELETE]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
