const IP_PATTERN = /^[a-f0-9:.]+$/i;

/**
 * Only trust the header written by Vercel. Raw x-forwarded-for and x-real-ip
 * values can be supplied by a client when the application is not behind a
 * trusted proxy, so they are deliberately ignored.
 */
export function getTrustedClientIdentifier(request: Request): string {
  const platformIp = process.env.VERCEL === "1" ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() : undefined;
  return platformIp && IP_PATTERN.test(platformIp) ? platformIp : "anonymous";
}
