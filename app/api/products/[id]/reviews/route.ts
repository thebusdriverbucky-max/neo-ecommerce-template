import { z } from "zod";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { revalidatePath } from "next/cache";
import { logger } from "@/lib/logger";
import { reviewSchema } from "@/lib/review-schema";
import { recalculateProductRating } from "@/lib/product-rating";

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

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
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    logger.error("Failed to load reviews");
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
      return new NextResponse(
        rateLimit.unavailable ? "Review protection is temporarily unavailable" : "Too Many Requests",
        { status: rateLimit.unavailable ? 503 : 429 },
      );
    }

    const parsed = reviewSchema.safeParse(await req.json());
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input", fieldErrors },
        { status: 400 },
      );
    }
    const { rating, title, comment } = parsed.data;

    const product = await db.product.findUnique({
      where: { id: params.id },
      select: { id: true, slug: true, isArchived: true },
    });
    // Archived products are hidden from the storefront, so they look missing.
    if (!product || product.isArchived) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    // The review and the cached product rating change together.
    const review = await db.$transaction(async (tx) => {
      const created = await tx.review.create({
        data: {
          rating,
          title: title || null,
          comment,
          productId: product.id,
          userId: session.user!.id!,
        },
      });
      await recalculateProductRating(tx, product.id);
      return created;
    });

    revalidatePath(`/products/${product.slug}`);
    revalidatePath("/products");

    return NextResponse.json(review);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    // One review per user and product (unique constraint).
    if (errorCode(error) === "P2002") {
      return NextResponse.json({ error: "You have already reviewed this product" }, { status: 409 });
    }
    logger.error("Failed to save review");
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

    const review = await db.review.findUnique({
      where: { id: reviewId },
      select: { id: true, productId: true, product: { select: { slug: true } } },
    });
    // The review must belong to the product in the URL, otherwise the wrong
    // product's rating would be recalculated.
    if (!review || review.productId !== params.id) {
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }

    await db.$transaction(async (tx) => {
      await tx.review.delete({ where: { id: review.id } });
      await recalculateProductRating(tx, review.productId);
    });

    revalidatePath(`/products/${review.product.slug}`);
    revalidatePath("/products");

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    // Deleted concurrently between the lookup and the delete.
    if (errorCode(error) === "P2025") {
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }
    logger.error("Failed to delete review");
    return new NextResponse("Internal Error", { status: 500 });
  }
}
