import { SignJWT, jwtVerify } from 'jose';

const LICENSE_SERVER_URL = process.env.LICENSE_SERVER_URL || '';
const LICENSE_KEY = process.env.LICENSE_KEY || '';
const LICENSE_PRODUCT = process.env.LICENSE_PRODUCT || 'neo-ecommerce-full';

export const LICENSE_COOKIE_NAME = 'neo_license';

let warnedNoSecret = false;

// Returns null when the secret is not configured (fail-closed).
export function getLicenseSecret() {
  const secret = process.env.LICENSE_SERVER_SECRET;
  if (!secret) {
    if (!warnedNoSecret) {
      console.error('⚠️ LICENSE_SERVER_SECRET is not configured — license tokens cannot be verified.');
      warnedNoSecret = true;
    }
    return null;
  }
  return new TextEncoder().encode(secret);
}

// Verify JWT locally — no network call, works in Edge Runtime
export async function verifyLicenseToken(token: string): Promise<boolean> {
  const secret = getLicenseSecret();
  if (!secret) return false;
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload.valid === true;
  } catch {
    return false;
  }
}

// Signed locally so the middleware can validate a grace period
// without hitting the license server on every request.
export async function createGraceToken(hours = 6): Promise<string> {
  const secret = getLicenseSecret();
  if (!secret) throw new Error('LICENSE_SERVER_SECRET is not configured');
  return await new SignJWT({ grace: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${hours}h`)
    .sign(secret);
}

export async function verifyGraceToken(token: string): Promise<boolean> {
  const secret = getLicenseSecret();
  if (!secret) return false;
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload.grace === true;
  } catch {
    return false;
  }
}

// Fetch fresh validation from license server
export async function fetchLicenseValidation(): Promise<{
  valid: boolean;
  token?: string;
  grace?: boolean;
  product?: string;
}> {
  // No key configured = license required
  if (!LICENSE_KEY || !LICENSE_SERVER_URL) {
    return { valid: false };
  }

  try {
    const response = await fetch(`${LICENSE_SERVER_URL}/api/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: LICENSE_KEY,
        product: LICENSE_PRODUCT
      }),
      signal: AbortSignal.timeout(10000),
    });

    // Server-side outage (5xx) — grant grace instead of blocking the site.
    // A 4xx means the key is genuinely invalid/revoked — fail closed.
    if (response.status >= 500) {
      return { valid: true, grace: true };
    }

    const data = await response.json();

    // Verify returned product matches what this project expects
    if (data.valid && data.product && data.product !== LICENSE_PRODUCT) {
      return { valid: false };
    }

    return data;
  } catch {
    // Server unreachable — grant grace period
    return { valid: true, grace: true };
  }
}
