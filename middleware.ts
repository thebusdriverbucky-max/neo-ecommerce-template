import NextAuth from 'next-auth';
import { authConfig } from '@/lib/auth.config';
import { NextRequest, NextResponse } from 'next/server';
import {
  verifyLicenseToken,
  verifyGraceToken,
  createGraceToken,
  fetchLicenseValidation,
  LICENSE_COOKIE_NAME,
} from '@/lib/license';

const { auth } = NextAuth(authConfig);

// Paths that skip license check entirely
const LICENSE_SKIP_PATHS = [
  '/license-required',
  '/api/auth',
  '/api/stripe/webhooks',
  '/_next',
  '/favicon.ico',
];

async function licenseMiddleware(request: NextRequest): Promise<NextResponse | null> {
  const pathname = request.nextUrl.pathname;

  // Skip check for system paths
  if (LICENSE_SKIP_PATHS.some(p => pathname.startsWith(p))) {
    return null;
  }


  // Check existing JWT cookie (full license token or locally-signed grace token)
  const cookieToken = request.cookies.get(LICENSE_COOKIE_NAME)?.value;
  if (cookieToken) {
    // Valid license JWT — allow through without any network call
    if (await verifyLicenseToken(cookieToken)) return null;
    // Valid grace token (license server was down earlier) — allow through
    // WITHOUT hitting the server again until the grace window expires.
    if (await verifyGraceToken(cookieToken)) return null;
  }

  // Cookie missing or expired — fetch from license server
  const { valid, token, grace } = await fetchLicenseValidation();

  if (!valid) {
    // License invalid or revoked — block access
    const url = request.nextUrl.clone();
    url.pathname = '/license-required';
    return NextResponse.redirect(url);
  }

  // Valid — set/refresh cookie and continue
  const response = NextResponse.next();

  if (token) {
    // Full JWT from server — valid 24h
    response.cookies.set(LICENSE_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 48, // 48h (grace period if server goes down)
      path: '/',
    });
  } else if (grace) {
    // Server unreachable — issue a short-lived SIGNED grace token so
    // subsequent requests skip the license server entirely until it
    // expires (site keeps working while the license server is down).
    try {
      const graceToken = await createGraceToken(6); // 6h grace
      response.cookies.set(LICENSE_COOKIE_NAME, graceToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 60 * 60 * 6, // 6h grace
        path: '/',
      });
    } catch {
      // LICENSE_SERVER_SECRET not configured — continue without a cookie;
      // each request will re-check against the license server.
    }
  }

  return response;
}

export default async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname.includes('stripe/webhooks')) {
    console.log("Middleware processing webhook:", pathname);
  }

  // 1. License check first
  const licenseResponse = await licenseMiddleware(request);

  // If it's a redirect (e.g. to /license-required), return it immediately
  if (licenseResponse && licenseResponse.status !== 200) {
    return licenseResponse;
  }

  // 2. Then NextAuth check
  // We call auth as a regular function to get the session/response
  const authResponse = await (auth as any)(request);

  // If NextAuth wants to redirect or return a specific response, use it
  if (authResponse && authResponse instanceof NextResponse && authResponse.status !== 200) {
    // If we have license cookies to set, add them to the auth redirect
    if (licenseResponse) {
      licenseResponse.cookies.getAll().forEach(cookie => {
        authResponse.cookies.set(cookie.name, cookie.value, {
          httpOnly: cookie.httpOnly,
          secure: cookie.secure,
          sameSite: cookie.sameSite,
          maxAge: cookie.maxAge,
          path: cookie.path,
        });
      });
    }
    return authResponse;
  }

  // If both are just "next", we might need to merge cookies
  if (licenseResponse && authResponse instanceof NextResponse) {
    licenseResponse.cookies.getAll().forEach(cookie => {
      authResponse.cookies.set(cookie.name, cookie.value, {
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite,
        maxAge: cookie.maxAge,
        path: cookie.path,
      });
    });
    return authResponse;
  }

  return authResponse || licenseResponse || NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/stripe/webhooks).*)',
  ],
};
