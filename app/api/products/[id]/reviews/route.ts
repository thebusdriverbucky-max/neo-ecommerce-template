import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { reviewSchema } from "@/lib/review-schema";
import { recalculateProductRating } from "@/lib/product-rating";
import { revalidatePath } from "next/cache";

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

function jsonError(error: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status });
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
    console.error("[REVIEWS_GET]", error);
    return jsonError("Could not load reviews. Please try again.", 500);
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return jsonError("Please log in to leave a review.", 401);
    }

    const rateLimit = await checkRateLimit(session.user.id!, "reviews");
    if (!rateLimit.success) {
      return jsonError(
        rateLimit.unavailable ? "Review protection is temporarily unavailable" : "Too many requests. Please try again later.",
        rateLimit.unavailable ? 503 : 429,
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonError("Invalid JSON request.", 400);
    }

    const parsed = reviewSchema.safeParse(body);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
      return jsonError(parsed.error.issues[0]?.message ?? "Invalid review.", 400, { fieldErrors });
    }
    const { rating, title, comment } = parsed.data;

    const product = await db.product.findUnique({
      where: { id: params.id },
      select: { id: true, slug: true, isArchived: true },
    });
    if (!product) {
      return jsonError("Product not found.", 404);
    }
    if (product.isArchived) {
      return jsonError("This product is no longer available, so it cannot be reviewed.", 409);
    }

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

    return NextResponse.json(review, { status: 201 });
  } catch (error) {
    if (errorCode(error) === "P2002") {
      return jsonError("You have already reviewed this product.", 409);
    }
    console.error("[REVIEWS_POST]", error);
    return jsonError("Could not save your review. Please try again.", 500);
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();

    if (!session?.user || session.user.role !== "ADMIN") {
      return jsonError("Unauthorized", 401);
    }

    const { searchParams } = new URL(req.url);
    const reviewId = searchParams.get("reviewId");

    if (!reviewId) {
      return jsonError("Review ID is required", 400);
    }

    const review = await db.review.findUnique({
      where: { id: reviewId },
      select: { id: true, productId: true, product: { select: { slug: true } } },
    });
    // The review must belong to the product in the URL, otherwise the wrong
    // product's rating would be recalculated.
    if (!review || review.productId !== params.id) {
      return jsonError("Review not found for this product.", 404);
    }

    await db.$transaction(async (tx) => {
      await tx.review.delete({ where: { id: review.id } });
      await recalculateProductRating(tx, params.id);
    });

    revalidatePath(`/products/${review.product.slug}`);
    revalidatePath("/products");

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (errorCode(error) === "P2025") {
      return jsonError("Review not found for this product.", 404);
    }
    console.error("[REVIEWS_DELETE]", error);
    return jsonError("Could not delete the review. Please try again.", 500);
  }
}
