import { db } from "@/lib/db";
import { rearmLowStockAlerts } from "@/lib/inventory-alerts";
import { logger } from "@/lib/logger";
import { expirePendingOrders } from "@/lib/manual-order";

export async function releaseExpiredReservations(): Promise<number> {
  return expirePendingOrders(db, new Date(), 100, {
    // Returned stock may lift a product back above its low-stock threshold.
    onStockReleased: (productIds) => rearmLowStockAlerts(db, productIds),
  });
}

/**
 * Lazy expiry for page loads, checkout and the admin list. A cleanup failure
 * must never make the catalog, checkout or admin screen unavailable; the next
 * request retries it. Stock reservation itself stays atomic and conditional.
 */
export async function releaseExpiredReservationsSafely(): Promise<void> {
  try {
    await releaseExpiredReservations();
  } catch (error) {
    logger.warn("Expired reservation cleanup failed", { name: error instanceof Error ? error.name : undefined });
  }
}

export const releaseExpiredReservationsForStorefront = releaseExpiredReservationsSafely;
