import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sendLowStockAlert } from "@/lib/email";
import { checkRateLimit } from "@/lib/rate-limit";
import { createOrderSchema } from "@/lib/validations";
import { generateOrderNumber } from "@/lib/order-number";
import { z } from "zod";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    const userId = session?.user?.id;

    // Verify userId exists in DB if provided
    let dbUserId = null;
    if (userId) {
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { id: true }
      });
      if (user) {
        dbUserId = user.id;
      } else {
        console.warn(`⚠️ User ID ${userId} from session not found in database. Proceeding as guest or with limited user data.`);
      }
    }

    const userIp = request.ip ?? "127.0.0.1";
    const rateLimitKey = dbUserId || userIp;

    // Rate Limiting
    const { success } = await checkRateLimit(rateLimitKey, "orders");
    if (!success) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429 }
      );
    }

    const body = await request.json();

    // Zod Validation
    let validatedData;
    try {
      validatedData = createOrderSchema.parse(body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid input", details: error.issues }, { status: 400 });
      }
      throw error;
    }

    const { items, shippingAddress, guestEmail } = validatedData;
    const { billingAddressId, discountCode, shippingAddressId: bodyShippingAddressId } = body;

    if (!dbUserId && !guestEmail) {
      return NextResponse.json({ error: "Email is required for guest checkout" }, { status: 400 });
    }

    // Fetch store settings
    const storeSettings = await db.storeSettings.findFirst();
    const taxRate = storeSettings?.taxRate ?? 0;
    const freeShippingThreshold = storeSettings?.freeShippingThreshold ?? 500;
    const storeCurrency = storeSettings?.currency || "USD";

    // Fetch products to get real prices and check stock
    const productIds = items.map((item: { productId: string }) => item.productId);
    const products = await db.product.findMany({
      where: { id: { in: productIds } },
    });

    let subtotal = 0;
    const orderItemsData: { productId: string; quantity: number; price: number }[] = [];

    for (const item of items) {
      const product = products.find((p) => p.id === item.productId);
      if (!product) {
        return NextResponse.json({ error: `Product not found: ${item.productId}` }, { status: 400 });
      }

      if (product.stock < item.quantity) {
        return NextResponse.json({ error: `Insufficient stock for ${product.name}` }, { status: 400 });
      }

      const price = Number(product.price);
      subtotal += price * item.quantity;

      orderItemsData.push({
        productId: product.id,
        quantity: item.quantity,
        price: price,
      });
    }

    let discountAmount = 0;

    if (discountCode) {
      const discount = await db.discountCode.findUnique({
        where: { code: discountCode.toUpperCase() },
      });

      if (discount && discount.isActive && (!discount.expiresAt || discount.expiresAt > new Date())) {
        if (discount.type === "FIXED") {
          discountAmount = Math.min(discount.value, subtotal);
        } else {
          discountAmount = (subtotal * discount.value) / 100;
        }
      }
    }

    const total = Math.max(0, subtotal - discountAmount);
    const tax = total * (taxRate / 100);
    const shippingCost =
      total >= freeShippingThreshold ? 0 : storeSettings?.shippingCost ?? 5;
    const shipping = shippingCost;
    const finalTotal = total + tax + shipping;

    // Transaction for atomic order creation and stock update
    const order = await db.$transaction(async (tx) => {
      let finalShippingAddressId = bodyShippingAddressId || null;

      if (shippingAddress) {
        const newAddress = await tx.address.create({
          data: {
            ...shippingAddress,
            state: shippingAddress.state || "",
            userId: dbUserId || undefined,
          } as any,
        });
        finalShippingAddressId = newAddress.id;
      }

      // Generate order number
      let orderNumber;
      try {
        orderNumber = await generateOrderNumber();
      } catch (err) {
        throw new Error("Failed to generate order number");
      }

      // Create order
      const orderData: any = {
        orderNumber: orderNumber,
        status: "PENDING",
        subtotal: subtotal,
        tax: tax,
        shippingCost: shipping,
        total: finalTotal,
        currency: storeCurrency,
        shippingAddressId: finalShippingAddressId,
        billingAddressId,
        items: {
          create: orderItemsData.map(item => ({
            productId: item.productId,
            quantity: item.quantity,
            price: item.price,
          })),
        },
      };

      if (dbUserId) {
        orderData.userId = dbUserId;
      } else {
        orderData.guestEmail = guestEmail;
      }

      const newOrder = await tx.order.create({ data: orderData });

      return newOrder;
    });

    // Check for low stock after transaction (best effort)
    // Use Promise.allSettled to ensure email failures don't block the process
    // We don't await this to avoid blocking the response
    const lowStockAlerts = async () => {
      try {
        const alerts = orderItemsData.map(async (item) => {
          const product = await db.product.findUnique({ where: { id: item.productId } });
          if (product && product.stock < 5) {
            return sendLowStockAlert(product.name, product.stock);
          }
        });
        await Promise.allSettled(alerts);
      } catch (err) {
        console.error("Email alert background process error:", err);
      }
    };
    lowStockAlerts();

    return NextResponse.json({
      orderId: order.id,
      orderNumber: order.orderNumber
    });
  } catch (error: any) {
    console.error("❌ DETAILED Order creation error:", {
      message: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code,
      userId: (await auth())?.user?.id,
    });
    if (error.clientVersion) {
      console.error("Prisma Error Details:", {
        code: error.code,
        meta: error.meta,
      });
    }
    return NextResponse.json(
      { error: "Failed to create order", message: error.message, stack: process.env.NODE_ENV === 'development' ? error.stack : undefined },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    // Проверка что пользователь - админ
    if (!session?.user?.id || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Получить все заказы с данными юзера и товарами
    const orders = await db.order.findMany({
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        shippingAddress: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            street: true,
            city: true,
            state: true,
            postalCode: true,
            country: true,
          },
        },
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                price: true,
                image: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json(orders);
  } catch (error) {
    console.error("❌ Error fetching orders:", error);
    return NextResponse.json(
      { error: "Failed to fetch orders" },
      { status: 500 }
    );
  }
}
