import type { PrismaClient } from "@prisma/client";

type RawClient = Pick<PrismaClient, "$queryRaw" | "$executeRaw">;

const SEQUENCE_DIGITS = 6;

/**
 * Formats an order number as #YYYY-NNNNNN. Sequences above 999999 keep
 * growing (#YYYY-1000000) instead of wrapping.
 */
export function formatOrderNumber(year: number, sequence: number): string {
  return `#${year}-${sequence.toString().padStart(SEQUENCE_DIGITS, "0")}`;
}

function yearPattern(year: number): string {
  return `^#${year}-[0-9]{1,9}$`;
}

/**
 * Allocates the next order number for the current UTC year.
 *
 * The counter row is incremented by a single atomic upsert that commits on
 * its own, outside the order transaction. Concurrent checkouts therefore
 * serialize only on this short statement and never receive the same number.
 * A failed checkout leaves a gap, which is acceptable for order numbers.
 *
 * A missing year row is seeded from the highest existing order number of
 * that year, so numbering continues after an upgrade or a year change.
 */
export async function allocateOrderNumber(client: RawClient, now = new Date()): Promise<string> {
  const year = now.getUTCFullYear();
  const pattern = yearPattern(year);
  const rows = await client.$queryRaw<{ value: number }[]>`
    INSERT INTO "OrderNumberCounter" ("year", "value", "updatedAt")
    VALUES (
      ${year},
      COALESCE((
        SELECT MAX(CAST(substring("orderNumber" FROM '-([0-9]{1,9})$') AS INTEGER))
        FROM "Order"
        WHERE "orderNumber" ~ ${pattern}
      ), 0) + 1,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("year") DO UPDATE
      SET "value" = "OrderNumberCounter"."value" + 1,
          "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "value"
  `;
  const sequence = Number(rows[0]?.value);
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error("ORDER_NUMBER_ALLOCATION_FAILED");
  }
  return formatOrderNumber(year, sequence);
}

/**
 * Moves the counter past any order number that already exists. Used after a
 * unique-constraint conflict, e.g. orders created by a previous release
 * while a new deployment was being built.
 */
export async function resyncOrderNumberCounter(client: RawClient, now = new Date()): Promise<void> {
  const year = now.getUTCFullYear();
  const pattern = yearPattern(year);
  await client.$executeRaw`
    UPDATE "OrderNumberCounter"
    SET "value" = GREATEST("value", COALESCE((
          SELECT MAX(CAST(substring("orderNumber" FROM '-([0-9]{1,9})$') AS INTEGER))
          FROM "Order"
          WHERE "orderNumber" ~ ${pattern}
        ), 0)),
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "year" = ${year}
  `;
}

/** True when a Prisma error is a unique violation on Order.orderNumber. */
export function isOrderNumberConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, meta } = error as { code?: unknown; meta?: { target?: unknown } };
  if (code !== "P2002") return false;
  const target = meta?.target;
  if (Array.isArray(target)) return target.includes("orderNumber");
  return typeof target === "string" && target.includes("orderNumber");
}
