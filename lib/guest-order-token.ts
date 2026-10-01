import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_VERSION = "v1";
export const GUEST_ORDER_LINK_TTL_SECONDS = 60 * 60 * 24 * 30;

function secret(): string | null {
  const value = process.env.GUEST_ORDER_TOKEN_SECRET?.trim();
  return value && value.length >= 32 ? value : null;
}

export function guestOrderTokensConfigured(): boolean {
  return secret() !== null;
}

function signature(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function createGuestOrderToken(orderId: string, expiresAt = new Date(Date.now() + GUEST_ORDER_LINK_TTL_SECONDS * 1000)): string {
  const key = secret();
  if (!key) throw new Error("Guest order links are not configured");
  const payload = `${TOKEN_VERSION}.${orderId}.${Math.floor(expiresAt.getTime() / 1000)}`;
  return `${payload}.${signature(payload, key)}`;
}

export function verifyGuestOrderToken(token: string | null | undefined, orderId: string, now = new Date()): boolean {
  const key = secret();
  if (!key || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 4) return false;
  const [version, tokenOrderId, expiry, supplied] = parts;
  if (version !== TOKEN_VERSION || tokenOrderId !== orderId || !/^\d+$/.test(expiry)) return false;
  if (Number(expiry) <= Math.floor(now.getTime() / 1000)) return false;
  const expected = signature(`${version}.${tokenOrderId}.${expiry}`, key);
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}
