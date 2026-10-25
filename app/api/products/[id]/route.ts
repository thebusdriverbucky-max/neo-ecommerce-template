// File: app/api/products/[id]/route.ts

import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { productSchema } from "@/lib/validations";
import { productFieldErrors, productWriteError } from "@/lib/product-feedback";
import { logger } from "@/lib/logger";
import { rearmLowStockAlerts } from "@/lib/inventory-alerts";

function inOrdersMessage(count?: number): string {
  const subject = count === undefined ? "appears in existing orders" : `appears in ${count} order(s)`;
  return `This product ${subject} and can't be deleted. Archive it instead — it will be hidden from the store and kept in order history.`;
}

function revalidateProductPaths(...slugs: Array<string | undefined>) {
  revalidatePath("/products");
  for (const slug of new Set(slugs)) {
    if (slug) revalidatePath(`/products/${slug}`);
  }
  revalidatePath("/");
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const product = await db.product.findUnique({
      where: { id: params.id },
    });

    if (!product || (product.isArchived && (await auth())?.user?.role !== "ADMIN")) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    return NextResponse.json(product);
  } catch (error) {
    logger.error("Product fetch error", { error: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json(
      { error: "Failed to fetch product" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();

  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = productSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({
        error: "Please correct the highlighted fields.",
        fieldErrors: productFieldErrors(parsed.error.issues),
        details: parsed.error.issues,
      }, { status: 400 });
    }

    // The previous slug is needed to refresh the old URL after a rename.
    const previous = await db.product.findUnique({
      where: { id: params.id },
      select: { slug: true },
    });

    const updatedProduct = await db.product.update({
      where: { id: params.id },
      data: parsed.data,
    });

    // The admin may have raised the stock above the low-stock threshold.
    try {
      await rearmLowStockAlerts(db, [params.id]);
    } catch (error) {
      logger.warn("Low stock alert re-arm failed", { productId: params.id, error: error instanceof Error ? error.name : "unknown" });
    }

    revalidateProductPaths(previous?.slug, updatedProduct.slug);

    return NextResponse.json(updatedProduct);
  } catch (error) {
    const failure = productWriteError(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();

  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const hardDelete = url.searchParams.get("hard") === "true";

    if (hardDelete) {
      // OrderItem.productId is RESTRICT: a product that was ever ordered can
      // only be archived, which keeps it in the order history.
      const orderCount = await db.orderItem.count({ where: { productId: params.id } });
      if (orderCount > 0) {
        return NextResponse.json({ error: inOrdersMessage(orderCount) }, { status: 409 });
      }
      const deleted = await db.product.delete({
        where: { id: params.id },
      });
      revalidateProductPaths(deleted?.slug);
      return NextResponse.json({ message: "Product deleted permanently" }, { status: 200 });
    } else {
      const archived = await db.product.update({
        where: { id: params.id },
        data: { isArchived: true },
      });
      revalidateProductPaths(archived?.slug);
      return NextResponse.json({ message: "Product archived" }, { status: 200 });
    }
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code === "P2025") {
      return NextResponse.json({ error: "Product no longer exists. Refresh the product list." }, { status: 404 });
    }
    if (code === "P2003") {
      // An order referenced the product between the check and the delete.
      return NextResponse.json({ error: inOrdersMessage() }, { status: 409 });
    }
    logger.error("Product deletion error", { error: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json(
      { error: "Failed to delete/archive product" },
      { status: 500 }
    );
  }
}
