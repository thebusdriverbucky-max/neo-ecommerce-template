// Pure helpers for GET /api/admin/analytics (no server-only imports).

/**
 * Statuses of orders whose bank transfer was confirmed. PENDING (unpaid) and
 * CANCELLED never count. REFUNDED and PARTIALLY_REFUNDED are excluded too:
 * Lite stores no refunded amount, so their net revenue is unknown.
 */
export const PAID_ORDER_STATUSES = ["CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED"] as const;

export const ANALYTICS_DAYS = 30;

type MoneyLike = { toString(): string } | number | string | null | undefined;

/** Converts a Prisma Decimal / string / number to a number rounded to cents. */
export function toMoney(value: MoneyLike): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

export function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Start (00:00 UTC) of the first day of the reporting window. */
export function analyticsWindowStart(now: Date, days = ANALYTICS_DAYS): Date {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start;
}

export type DailyRow = { day: string; total: MoneyLike };

/**
 * One entry per UTC day of the window, oldest first. Days without paid orders
 * are filled with 0 so charts show gaps instead of skipping dates.
 */
export function buildDailyRevenue(
  rows: DailyRow[],
  now: Date,
  days = ANALYTICS_DAYS,
): Array<{ date: string; revenue: number }> {
  const byDay = new Map<string, number>();
  for (const row of rows) {
    const key = String(row.day).slice(0, 10);
    byDay.set(key, Math.round(((byDay.get(key) ?? 0) + toMoney(row.total)) * 100) / 100);
  }
  const start = analyticsWindowStart(now, days);
  const result: Array<{ date: string; revenue: number }> = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + i);
    const key = utcDateKey(day);
    result.push({ date: key, revenue: byDay.get(key) ?? 0 });
  }
  return result;
}

export function averageOrderValue(revenue: number, paidOrders: number): number {
  return paidOrders > 0 ? Math.round((revenue / paidOrders) * 100) / 100 : 0;
}
