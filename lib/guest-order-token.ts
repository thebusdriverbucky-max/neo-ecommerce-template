import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function getSecret(): string {
  const secret = process.env.GUEST_ORDER_TOKEN_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("GUEST_ORDER_TOKEN_SECRET or NEXTAUTH_SECRET must contain at least 32 characters");
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

export function hashGuestOrderToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createGuestOrderToken(
  orderId: string,
  expiresAt: Date = new Date(Date.now() + TOKEN_TTL_MS)
): string {
  const expiresAtSeconds = Math.floor(expiresAt.getTime() / 1000);
  const payload = `${orderId}.${expiresAtSeconds}`;
  return `${payload}.${sign(payload)}`;
}

export function createGuestOrderTokenExpiry(): Date {
  return new Date(Date.now() + TOKEN_TTL_MS);
}

export function verifyGuestOrderToken(
  token: string,
  orderId: string,
  expectedHash: string | null,
  expiresAt: Date | null
): boolean {
  if (!token || !expectedHash || !expiresAt) return false;

  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== orderId) return false;

  const expiresAtSeconds = Number(parts[1]);
  if (!Number.isSafeInteger(expiresAtSeconds)) return false;
  if (Date.now() >= expiresAtSeconds * 1000) return false;
  if (Date.now() >= expiresAt.getTime()) return false;

  const payload = `${parts[0]}.${parts[1]}`;
  const expectedSignature = sign(payload);
  const actualSignature = parts[2];
  const expectedSignatureBuffer = Buffer.from(expectedSignature);
  const actualSignatureBuffer = Buffer.from(actualSignature);
  if (expectedSignatureBuffer.length !== actualSignatureBuffer.length) return false;
  const signaturesMatch = timingSafeEqual(expectedSignatureBuffer, actualSignatureBuffer);
  if (!signaturesMatch) return false;

  const actualHash = hashGuestOrderToken(token);
  const expectedHashBuffer = Buffer.from(expectedHash);
  const actualHashBuffer = Buffer.from(actualHash);
  return expectedHashBuffer.length === actualHashBuffer.length &&
    timingSafeEqual(expectedHashBuffer, actualHashBuffer);
}
