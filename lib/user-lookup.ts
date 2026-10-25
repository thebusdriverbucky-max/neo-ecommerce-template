import type { PrismaClient } from "@prisma/client";

type UserReader = Pick<PrismaClient, "user">;

/** Canonical form used when storing and comparing email addresses. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Finds a user by email regardless of letter case. Emails are stored
 * lowercase, but older databases can contain mixed-case rows (even two rows
 * differing only by case), so an exact match always wins and the oldest
 * case-insensitive match is the fallback.
 */
export async function findUserByEmail(client: UserReader, email: string) {
  const trimmed = email.trim();

  const exact = await client.user.findUnique({ where: { email: trimmed } });
  if (exact) return exact;

  return client.user.findFirst({
    where: { email: { equals: trimmed, mode: "insensitive" } },
    orderBy: { createdAt: "asc" },
  });
}
