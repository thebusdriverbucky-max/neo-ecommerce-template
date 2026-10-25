// File: app/api/products/route.ts

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { productFieldErrors, productWriteError } from "@/lib/product-feedback";
import { auth } from "@/lib/auth";
import { productSchema } from "@/lib/validations";
import { getStoreSettings } from "@/lib/store-settings";

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 100;
// Responses without ?page keep the legacy shape (a bare array) and cap.
const LEGACY_LIMIT = 50;

function positiveInt(value: string | null, fallback: number): number {
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

/** A finite number, or undefined when the parameter is missing or malformed. */
function priceBound(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const category = searchParams.get("category");
    const minPrice = priceBound(searchParams.get("minPrice"));
    const maxPrice = priceBound(searchParams.get("maxPrice"));
    const search = searchParams.get("search")?.trim().slice(0, 100);

    // Archived products are only listed for administrators; the flag is
    // silently ignored for everybody else.
    let includeArchived = false;
    if (searchParams.get("all") === "true") {
      const session = await auth();
      includeArchived = session?.user?.role === "ADMIN";
    }

    const where: Prisma.ProductWhereInput = {};

    if (minPrice !== undefined || maxPrice !== undefined) {
      where.price = {
        ...(minPrice !== undefined ? { gte: minPrice } : {}),
        ...(maxPrice !== undefined ? { lte: maxPrice } : {}),
      };
    }

    if (!includeArchived) {
      where.isArchived = false;
    }

    if (category && category !== "all") {
      where.category = category;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { slug: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    // id breaks createdAt ties so pages never repeat or skip products.
    const orderBy: Prisma.ProductOrderByWithRelationInput[] = [{ createdAt: "desc" }, { id: "desc" }];

    if (searchParams.get("page") === null) {
      const products = await db.product.findMany({ where, orderBy, take: LEGACY_LIMIT });
      return NextResponse.json(products);
    }

    const page = positiveInt(searchParams.get("page"), 1);
    const pageSize = Math.min(positiveInt(searchParams.get("pageSize"), DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
    const [total, products] = await Promise.all([
      db.product.count({ where }),
      db.product.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
    ]);

    return NextResponse.json({ products, total, page, pageSize });
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

    const settings = await getStoreSettings(db);
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
