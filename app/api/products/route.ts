// File: app/api/products/route.ts

import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { productFieldErrors, productWriteError } from "@/lib/product-feedback";
import { auth } from "@/lib/auth";
import { productSchema } from "@/lib/validations";
import { releaseExpiredReservationsForStorefront } from "@/lib/reservation-cleanup";

export async function GET(request: NextRequest) {
  try {
    await releaseExpiredReservationsForStorefront();
    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get("category");
    const minPrice = parseFloat(searchParams.get("minPrice") || "0");
    const maxPrice = parseFloat(searchParams.get("maxPrice") || "999999");
    const search = searchParams.get("search");
    const all = searchParams.get("all") === "true";
    if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice) || minPrice < 0 || maxPrice < minPrice) {
      return NextResponse.json({ error: "Invalid price range" }, { status: 400 });
    }
    if (all && (await auth())?.user?.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const where: any = {
      price: {
        gte: minPrice,
        lte: maxPrice,
      },
    };

    if (!all) {
      where.isArchived = false;
    }

    if (category && category !== "all") {
      where.category = category;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    const products = await db.product.findMany({
      where,
      take: 50,
    });

    return NextResponse.json(products);
  } catch (error) {
    console.error("Products API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch products" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (session?.user?.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    // Validate admin input with the shared Zod schema
    const parsed = productSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Please correct the highlighted fields.", fieldErrors: productFieldErrors(parsed.error.issues), details: parsed.error.issues },
        { status: 400 }
      );
    }
    const data = parsed.data;

    const settings = await db.storeSettings.findFirst();
    const currency = settings?.currency || "USD";

    const product = await db.product.create({
      data: {
        name: data.name,
        slug: data.slug,
        description: data.description,
        price: data.price,
        currency: currency,
        image: data.image,
        images: data.images || [],
        category: data.category,
        stock: data.stock,
        featured: data.featured,
        isArchived: data.isArchived ?? false,
      },
    });

    revalidatePath("/products");
    revalidatePath("/");

    return NextResponse.json(product, { status: 201 });
  } catch (error) {
    const failure = productWriteError(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
