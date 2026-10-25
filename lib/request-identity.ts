import { createHmac } from "node:crypto";

const IP_PATTERN = /^[a-f0-9:.]+$/i;

export const ANONYMOUS_CLIENT = "anonymous";

/**
 * Only trust the header written by Vercel. Raw x-forwarded-for and x-real-ip
 * values can be supplied by a client when the application is not behind a
 * trusted proxy, so they are deliberately ignored.
 */
export function getTrustedClientIdentifier(request: Request): string {
  const platformIp = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  return platformIp && IP_PATTERN.test(platformIp) ? platformIp : ANONYMOUS_CLIENT;
}

/**
 * Keyed HMAC-SHA256 of a trusted client identifier. The raw IP address is
 * never stored; the hash only lets the checkout count unpaid reservations per
 * client without Redis. Returns null for an unknown client or when no secret
 * is configured.
 */
export function hashClientIdentifier(identifier: string): string | null {
  if (!identifier || identifier === ANONYMOUS_CLIENT) return null;
  const secret = process.env.GUEST_ORDER_TOKEN_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update(identifier).digest("hex");
}
