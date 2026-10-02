import NextAuth from 'next-auth';
import { authConfig } from '@/lib/auth.config';
import { NextRequest, NextResponse } from 'next/server';
import { verifyLicenseToken, fetchLicenseValidation, LICENSE_COOKIE_NAME } from '@/lib/license';

const { auth } = NextAuth(authConfig);

// Paths that skip license check entirely
const LICENSE_SKIP_PATHS = [
  '/license-required',
  '/api/auth',
  '/_next',
  '/favicon.ico',
];

async function licenseMiddleware(request: NextRequest): Promise<NextResponse | null> {
  const pathname = request.nextUrl.pathname;

  // Skip check for system paths
  if (LICENSE_SKIP_PATHS.some(p => (pathname === p || pathname.startsWith(`${p}/`)))) {
    return null;
  }


  // Check existing JWT cookie
  const cookieToken = request.cookies.get(LICENSE_COOKIE_NAME)?.value;
  if (cookieToken) {
    const isValid = await verifyLicenseToken(cookieToken);
    if (isValid) return null; // Valid JWT — allow through
  }

  // Cookie missing or expired — fetch from license server
  const { valid, token } = await fetchLicenseValidation();

  if (!valid || !token) {
    // License invalid or revoked — block access
    const url = request.nextUrl.clone();
    url.pathname = '/license-required';
    return NextResponse.redirect(url);
  }

  // Valid — set/refresh cookie and continue
  const response = NextResponse.next();

  if (token) {
    // The signed token expiry is enforced on every request.
    response.cookies.set(LICENSE_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 24,
      path: '/',
    });
  }

  return response;
}

export default async function middleware(request: NextRequest) {
  // 1. License check first
  const licenseResponse = await licenseMiddleware(request);

  // If it's a redirect (e.g. to /license-required), return it immediately
  if (licenseResponse && licenseResponse.status !== 200) {
    return licenseResponse;
  }

  // 2. Then NextAuth check
  const authResponse = await (auth as any)(request);

  const copyLicenseCookies = (response: NextResponse) => {
    licenseResponse?.cookies.getAll().forEach(cookie => {
      response.cookies.set(cookie.name, cookie.value, {
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite,
        maxAge: cookie.maxAge,
        path: cookie.path,
      });
    });

    return response;
  };

  // If NextAuth wants to redirect or return a specific response, use it
  if (authResponse && authResponse instanceof NextResponse && authResponse.status !== 200) {
    return copyLicenseCookies(authResponse);
  }

  if (authResponse instanceof NextResponse) {
    return copyLicenseCookies(authResponse);
  }

  if (licenseResponse) return licenseResponse;
  if (authResponse) return authResponse;

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
