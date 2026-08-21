import { auth } from "@/lib/auth";
import { db, withDbRetry } from "@/lib/db";
import { stripe } from "@/lib/stripe";
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

    // `request.ip` is undefined in Next.js — use the proxy header instead,
    // otherwise ALL guests share a single "127.0.0.1" rate-limit bucket.
    const userIp =
      request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
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

    // Limit pending orders to prevent stock blocking
    const pendingOrdersCount = await db.order.count({
      where: {
        OR: [
          { userId: dbUserId || undefined },
          { guestEmail: !dbUserId ? (body.guestEmail || "unknown") : undefined }
        ],
        status: "PENDING",
        createdAt: {
          gte: new Date(Date.now() - 30 * 60 * 1000) // Last 30 minutes
        }
      }
    });

    if (pendingOrdersCount >= 3) {
      return NextResponse.json(
        { error: "You have too many pending orders. Please complete or cancel them before placing a new one." },
        { status: 429 }
      );
    }

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

    // Validate optional address IDs coming from the raw body (must be cuids)
    const cuidRegex = /^c[a-z0-9]{20,}$/i;
    if (billingAddressId !== undefined && billingAddressId !== null && !(typeof billingAddressId === "string" && cuidRegex.test(billingAddressId))) {
      return NextResponse.json({ error: "Invalid billingAddressId" }, { status: 400 });
    }
    if (bodyShippingAddressId !== undefined && bodyShippingAddressId !== null && !(typeof bodyShippingAddressId === "string" && cuidRegex.test(bodyShippingAddressId))) {
      return NextResponse.json({ error: "Invalid shippingAddressId" }, { status: 400 });
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

    // Transaction for atomic order creation and stock update.
    // Retried on order-number collisions (P2002) caused by concurrent orders.
    const createOrderTransaction = () =>
      db.$transaction(async (tx) => {
        let finalShippingAddressId = bodyShippingAddressId || null;

        if (shippingAddress) {
          const newAddress = await tx.address.create({
            data: {
              firstName: shippingAddress.firstName,
              lastName: shippingAddress.lastName,
              email: shippingAddress.email,
              phone: shippingAddress.phone,
              street: shippingAddress.street,
              city: shippingAddress.city,
              state: shippingAddress.state || "",
              postalCode: shippingAddress.postalCode,
              country: shippingAddress.country,
              userId: dbUserId,
            },
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
          billingAddressId: billingAddressId || null,
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

        // Decrement stock to reserve it temporarily.
        // Conditional decrement prevents negative stock under concurrency:
        // if any product no longer has enough stock, the whole
        // transaction is rolled back.
        for (const item of orderItemsData) {
          const updated = await tx.product.updateMany({
            where: {
              id: item.productId,
              stock: { gte: item.quantity },
            },
            data: {
              stock: {
                decrement: item.quantity,
              },
            },
          });

          if (updated.count === 0) {
            throw new Error(`INSUFFICIENT_STOCK:${item.productId}`);
          }
        }

        return newOrder;
      });

    let order;
    try {
      order = await withDbRetry(createOrderTransaction);
    } catch (error: any) {
      if (String(error?.message ?? "").startsWith("INSUFFICIENT_STOCK:")) {
        return NextResponse.json(
          { error: "Insufficient stock for one or more items" },
          { status: 409 }
        );
      }
      // Unique constraint on orderNumber — regenerate and try again
      if (error?.code === "P2002") {
        try {
          order = await withDbRetry(createOrderTransaction);
        } catch (retryError: any) {
          console.error("❌ Order creation failed after retry:", retryError);
          return NextResponse.json(
            { error: "Failed to create order" },
            { status: 500 }
          );
        }
      } else {
        throw error;
      }
    }

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
    await lowStockAlerts();

    const currency = storeCurrency.toLowerCase();

    // Tax is taken ONLY from admin store settings and is already included
    // in the order total. We deliberately do NOT pass Stripe `tax_rates`
    // on line items — that would charge tax a second time on top of the
    // total computed above. If no tax rate is configured in the admin,
    // no tax is applied at all.
    const line_items = orderItemsData.map((item) => {
      const product = products.find((p) => p.id === item.productId);
      return {
        price_data: {
          currency: currency,
          product_data: {
            name: product?.name || "Product",
            images: product?.image ? [product.image] : [],
          },
          unit_amount: Math.round(Number(item.price) * 100),
        },
        quantity: item.quantity,
      };
    });

    let stripeDiscounts = undefined;
    if (discountAmount > 0) {
      try {
        const coupon = await stripe.coupons.create({
          amount_off: Math.round(discountAmount * 100),
          currency: currency,
          duration: 'once',
          name: discountCode,
        });
        stripeDiscounts = [{ coupon: coupon.id }];
      } catch (error) {
        console.error("Stripe coupon creation failed:", error);
        // Continue without discount if coupon creation fails
      }
    }

    let stripeSession;
    try {
      stripeSession = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items,
        mode: "payment",
        success_url: `${process.env.NEXT_PUBLIC_APP_URL}/orders/${order.id}?success=true`,
        cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/checkout?canceled=true`,
        metadata: {
          orderId: order.id,
          ...(dbUserId && { userId: dbUserId }),
        },
        payment_intent_data: {
          metadata: {
            orderId: order.id,
            ...(dbUserId && { userId: dbUserId }),
          },
        },
        discounts: stripeDiscounts,
        shipping_options: shippingCost > 0 ? [
          {
            shipping_rate_data: {
              type: 'fixed_amount',
              fixed_amount: {
                amount: Math.round(shippingCost * 100),
                currency: currency,
              },
              display_name: 'Standard Shipping',
            },
          },
        ] : undefined,
      });

      const stripeIdToSave = (stripeSession.payment_intent as string) || stripeSession.id;

      await db.order.update({
        where: { id: order.id },
        data: { stripePaymentIntentId: stripeIdToSave },
      });
    } catch (stripeError: any) {
      console.error("❌ Stripe Session Creation Failed:", {
        error: stripeError.message,
        stack: stripeError.stack,
        orderId: order.id,
        userId: userId
      });
      // If Stripe fails, we have an order in DB with PENDING status.
      // We should probably cancel the order to keep DB consistent with payment state.
      try {
        await db.$transaction(async (tx) => {
          await tx.order.update({
            where: { id: order.id },
            data: { status: "CANCELLED" },
          });

          // Restock items
          for (const item of orderItemsData) {
            await tx.product.update({
              where: { id: item.productId },
              data: {
                stock: {
                  increment: item.quantity,
                },
              },
            });
          }
        });
      } catch (updateError) {
        console.error("❌ Failed to cancel order and restock after Stripe failure:", updateError);
      }

      return NextResponse.json(
        {
          error: "Payment initialization failed",
          message: stripeError.message || "Could not create payment session. Your order has been cancelled."
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ url: stripeSession.url });
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
      {
        error: "Failed to create order",
        // Never leak internal error details in production
        message: process.env.NODE_ENV === 'development' ? error.message : undefined,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
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
