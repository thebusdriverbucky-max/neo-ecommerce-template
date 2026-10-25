import { PrismaClient } from "@prisma/client";

/**
 * Database tests run only against an explicitly provided disposable database
 * (CI sets TEST_DATABASE_URL to its PostgreSQL service). They never read
 * DATABASE_URL, so a store's production database cannot be used by accident.
 */
export function createTestDatabaseClient(): PrismaClient {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is required for database tests (use a disposable database)");
  }
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host) && process.env.ALLOW_REMOTE_TEST_DATABASE !== "true") {
    throw new Error("Database tests only run against a local database unless ALLOW_REMOTE_TEST_DATABASE=true");
  }
  return new PrismaClient({ datasources: { db: { url } } });
}
