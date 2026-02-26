import { db } from "../lib/db";

async function main() {
  try {
    console.log("\n🛒 Creating test order...\n");

    const user = await db.user.findFirst({ where: { role: "ADMIN" } });
    const products = await db.product.findMany({ take: 3 });

    if (!user || products.length === 0) {
      console.error("❌ Need users and products!");
      return;
    }

    console.log(`✅ User: ${user.name}`);
    console.log(`✅ Products: ${products.length}`);

    const orderItems = products.map(p => ({
      productId: p.id,
      quantity: 1,
      price: p.price,
    }));

    const subtotal = orderItems.reduce(
      (sum, item) => sum + Number(item.price),
      0
    );

    const tax = subtotal * 0.1; // 10%
    const shipping = 10; // $10
    const total = subtotal + tax + shipping;

    const order = await db.order.create({
      data: {
        userId: user.id,
        subtotal: subtotal,
        tax: tax,
        shippingCost: shipping,
        total: total,
        status: "PENDING",
        items: {
          create: orderItems,
        },
      },
      include: {
        items: { include: { product: true } },
      },
    });

    console.log("\n✅ Order created!");
    console.log("=".repeat(60));
    console.log(`Order ID: ${order.id.slice(0, 8)}`);
    console.log(`Customer: ${user.name}`);
    console.log(`Status: ${order.status}`);
    console.log(`Subtotal: $${Number(order.subtotal).toFixed(2)}`);
    console.log(`Tax: $${Number(order.tax).toFixed(2)}`);
    console.log(`Shipping: $${Number(order.shippingCost).toFixed(2)}`);
    console.log(`Total: $${Number(order.total).toFixed(2)}`);
    console.log(`\nItems:`);
    order.items.forEach((item, i) => {
      console.log(`  ${i + 1}. ${item.product.name} × ${item.quantity} = $${Number(item.price)}`);
    });
    console.log("=".repeat(60) + "\n");

  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await db.$disconnect();
  }
}

main();
