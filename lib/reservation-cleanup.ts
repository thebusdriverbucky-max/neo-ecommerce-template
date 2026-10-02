import { db } from "@/lib/db";
import { expirePendingOrders } from "@/lib/manual-order";

export async function releaseExpiredReservations(): Promise<number> {
  return expirePendingOrders(db);
}

export async function releaseExpiredReservationsForStorefront(): Promise<void> {
  try {
    await releaseExpiredReservations();
  } catch {
    // A cleanup race must not make the public catalog unavailable. Checkout
    // performs the same cleanup strictly before attempting to reserve stock.
    console.error("Expired reservation cleanup failed during storefront read");
  }
}
