import { jwtVerify } from 'jose';

const LICENSE_SERVER_URL = process.env.LICENSE_SERVER_URL || '';
const LICENSE_KEY = process.env.LICENSE_KEY || '';
const EXPECTED_PRODUCT = process.env.LICENSE_PRODUCT || 'neo-ecommerce-full';

export const LICENSE_COOKIE_NAME = 'neo_license';

export function getLicenseSecret() {
  return new TextEncoder().encode(
    process.env.LICENSE_SERVER_SECRET || 'fallback_dev_secret'
  );
}

// Verify JWT locally — no network call, works in Edge Runtime
export async function verifyLicenseToken(token: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, getLicenseSecret());
    return payload.valid === true;
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
      body: JSON.stringify({ key: LICENSE_KEY }),
      signal: AbortSignal.timeout(10000),
    });

    const data = await response.json();

    if (data.valid && data.product && data.product !== EXPECTED_PRODUCT) {
      return { valid: false };
    }

    return data;
  } catch {
    // Server unreachable — grant grace period
    return { valid: true, grace: true };
  }
}
