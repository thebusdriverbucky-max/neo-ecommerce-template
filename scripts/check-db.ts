import { db } from "../lib/db";

async function main() {
  try {
    // Проверь товары:
    const products = await db.product.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        price: true,
        stock: true,
        category: true,
      },
      orderBy: { createdAt: "desc" },
    });

    console.log("\n📦 PRODUCTS:");
    console.log("=".repeat(80));

    if (products.length === 0) {
      console.log("❌ No products found!");
    } else {
      products.forEach((p, i) => {
        console.log(`\n${i + 1}. ${p.name}`);
        console.log(`   ID: ${p.id}`);
        console.log(`   Slug: ${p.slug}`);
        console.log(`   Price: $${p.price}`);
        console.log(`   Stock: ${p.stock}`);
        console.log(`   Category: ${p.category}`);
      });
    }

    console.log("\n" + "=".repeat(80));
    console.log(`✅ Total: ${products.length} products\n`);

    // Проверь пользователей:
    const users = await db.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
    });

    console.log("\n👥 USERS:");
    console.log("=".repeat(80));

    users.forEach((u, i) => {
      console.log(`${i + 1}. ${u.name} (${u.email}) - ${u.role}`);
    });

    console.log("=".repeat(80) + "\n");

    // Проверь заказы:
    const orders = await db.order.findMany({
      include: {
        items: {
          include: { product: true },
        },
        user: true,
      },
      orderBy: { createdAt: "desc" },
    });

    console.log("\n📦 ORDERS:");
    console.log("=".repeat(80));

    if (orders.length === 0) {
      console.log("❌ No orders found!");
    } else {
      orders.forEach((order, i) => {
        console.log(`\n${i + 1}. Order #${order.id.slice(0, 8)}`);
        const customerName = order.user?.name || "Guest";
        const customerEmail = order.user?.email || order.guestEmail || "No email";
        console.log(`   Customer: ${customerName} (${customerEmail})`);
        console.log(`   Status: ${order.status}`);
        console.log(`   Total: $${order.total}`);
        console.log(`   Date: ${order.createdAt.toLocaleString()}`);
        console.log(`   Items:`);
        order.items.forEach(item => {
          console.log(`     - ${item.product.name} x${item.quantity} ($${item.price})`);
        });
      });
    }

    console.log("\n" + "=".repeat(80));
    console.log(`✅ Total: ${orders.length} orders\n`);

  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await db.$disconnect();
  }
}

main();
