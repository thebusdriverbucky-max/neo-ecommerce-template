// File: lib/db.ts

import { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const db =
  globalForPrisma.prisma ||
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["error", "warn"]
        : ["error"],
  });

// Cache the client in all environments to avoid creating a new
// connection pool on every import (important for Neon cold starts).
globalForPrisma.prisma = db;

/**
 * Retry helper for Neon cold starts / transient connection errors.
 * Retries Prisma errors P1001 (can't reach DB), P1002 (timed out),
 * P2024 (connection pool timeout) and AccelTimeout-style failures.
 */
const RETRYABLE_PRISMA_CODES = new Set(["P1001", "P1002", "P2024"]);

export async function withDbRetry<T>(
  operation: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 500
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      logger.warn("Database operation failed", {
        code: error?.code,
        attempt,
      });
      const isRetryable =
        RETRYABLE_PRISMA_CODES.has(error?.code) ||
        /accel|timeout|connect/i.test(String(error?.message ?? ""));

      if (!isRetryable || attempt === maxAttempts) {
        throw error;
      }

      // Exponential backoff: gives a cold-starting Neon compute time to wake up
      await new Promise((resolve) =>
        setTimeout(resolve, baseDelayMs * Math.pow(2, attempt - 1))
      );
    }
  }

  throw lastError;
}
