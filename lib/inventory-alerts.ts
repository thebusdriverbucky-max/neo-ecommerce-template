import type { Prisma, StoreSettings } from "@prisma/client";
import { db } from "@/lib/db";
import { sendLowStockEmail } from "@/lib/email";
import { logger } from "@/lib/logger";

export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

type AlertClient = Pick<Prisma.TransactionClient, "product" | "inventoryAlert">;

async function claimAlert(productId: string, threshold: number, hasRow: boolean): Promise<boolean> {
  if (hasRow) {
    const claimed = await db.inventoryAlert.updateMany({
      where: { productId, lastAlertAt: null },
      data: { lastAlertAt: new Date() },
    });
    return claimed.count === 1;
  }
  const created = await db.inventoryAlert.createMany({
    data: [{ productId, threshold, lastAlertAt: new Date() }],
    skipDuplicates: true,
  });
  return created.count === 1;
}

/**
 * Sends at most one low-stock email per product until it is restocked.
 * Call it after the admin confirms a payment, never when stock is only
 * reserved, so abandoned checkouts do not consume the email provider's quota.
 * Never throws: a failed alert must not affect the order operation.
 */
export async function notifyLowStock(productIds: string[], settings: StoreSettings | null): Promise<void> {
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return;

  try {
    const products = await db.product.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        stock: true,
        isArchived: true,
        inventoryAlert: { select: { threshold: true, lastAlertAt: true } },
      },
    });

    for (const product of products) {
      const threshold = product.inventoryAlert?.threshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
      if (product.isArchived || product.stock >= threshold || product.inventoryAlert?.lastAlertAt) continue;

      // The claim is atomic, so concurrent confirmations send a single email.
      if (!(await claimAlert(product.id, threshold, Boolean(product.inventoryAlert)))) continue;

      const sent = await sendLowStockEmail(product.name, product.stock, settings);
      if (!sent) {
        logger.error("Low stock alert was not delivered", { productId: product.id });
        // Re-arm so a later confirmation can retry the notification.
        await db.inventoryAlert.updateMany({ where: { productId: product.id }, data: { lastAlertAt: null } });
      }
    }
  } catch {
    logger.error("Low stock alert check failed");
  }
}

/**
 * Re-arms alerts for products whose stock is back at or above the threshold
 * (admin restock, cancelled reservation). Safe to call inside a transaction.
 */
export async function rearmLowStockAlerts(client: AlertClient, productIds: string[]): Promise<void> {
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return;

  const products = await client.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, stock: true, inventoryAlert: { select: { threshold: true, lastAlertAt: true } } },
  });
  const rearm = products
    .filter((product) => product.inventoryAlert?.lastAlertAt && product.stock >= product.inventoryAlert.threshold)
    .map((product) => product.id);
  if (rearm.length === 0) return;

  await client.inventoryAlert.updateMany({
    where: { productId: { in: rearm } },
    data: { lastAlertAt: null },
  });
}
