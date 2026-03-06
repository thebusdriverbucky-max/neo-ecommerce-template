// File: app/api/products/[id]/route.ts

import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const product = await db.product.findUnique({
      where: { id: params.id },
    });

    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    return NextResponse.json(product);
  } catch (error) {
    console.error("Product fetch error:", error);
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
    const { name, slug, description, price, currency, image, images, category, stock, featured } =
      body;

    const updatedProduct = await db.product.update({
      where: { id: params.id },
      data: {
        name,
        slug,
        description,
        price,
        currency,
        image,
        images: images || [],
        category,
        stock,
        featured,
      },
    });

    revalidatePath("/products");
    revalidatePath(`/products/${updatedProduct.slug}`);
    revalidatePath("/");

    return NextResponse.json(updatedProduct);
  } catch (error) {
    console.error("Product update error:", error);
    return NextResponse.json(
      { error: "Failed to update product" },
      { status: 500 }
    );
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
      await db.product.delete({
        where: { id: params.id },
      });
      return NextResponse.json({ message: "Product deleted permanently" }, { status: 200 });
    } else {
      await db.product.update({
        where: { id: params.id },
        data: { isArchived: true },
      });
      revalidatePath("/products");
      revalidatePath("/");
      return NextResponse.json({ message: "Product archived" }, { status: 200 });
    }
  } catch (error) {
    console.error("Product deletion error:", error);
    return NextResponse.json(
      { error: "Failed to delete/archive product" },
      { status: 500 }
    );
  }
}
