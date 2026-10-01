import { jwtVerify } from "jose";

export const LICENSE_COOKIE_NAME = "neo_license";

// No development secret or assumed product: the issued product must be explicit.
export function getLicenseSecret() {
  const secret = process.env.LICENSE_SERVER_SECRET?.trim();
  return secret ? new TextEncoder().encode(secret) : null;
}

export async function verifyLicenseToken(token: string): Promise<boolean> {
  const secret = getLicenseSecret();
  const product = process.env.LICENSE_PRODUCT?.trim();
  const key = process.env.LICENSE_KEY?.trim();
  if (!secret || !product || !key) return false;
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"], requiredClaims: ["exp"] });
    return payload.valid === true && payload.product === product && payload.key === key;
  } catch {
    return false;
  }
}

export async function fetchLicenseValidation(): Promise<{
  valid: boolean;
  token?: string;
  grace?: boolean;
  product?: string;
}> {
  const server = process.env.LICENSE_SERVER_URL?.trim();
  const key = process.env.LICENSE_KEY?.trim();
  const product = process.env.LICENSE_PRODUCT?.trim();
  if (!server || !key || !product || !getLicenseSecret()) return { valid: false };

  try {
    const url = new URL(server);
    if (url.protocol !== "https:" || url.username || url.password) return { valid: false };
    const response = await fetch(`${server.replace(/\/$/, "")}/api/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, product }),
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) return { valid: false };
    const data = await response.json();
    if (data?.valid !== true || data.product !== product || typeof data.token !== "string"
      || !(await verifyLicenseToken(data.token))) return { valid: false };
    return { valid: true, token: data.token, product };
  } catch {
    // Only an unexpired, previously verified cookie permits offline access.
    return { valid: false };
  }
}
