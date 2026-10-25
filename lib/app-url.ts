/**
 * Public base URL used for links in emails. NEXT_PUBLIC_APP_URL is the
 * canonical setting; NEXT_PUBLIC_STORE_URL and NEXT_PUBLIC_SITE_URL are legacy
 * aliases. Returns null when none is a usable http(s) URL, so callers omit the
 * link instead of sending one that points at localhost or a demo domain.
 */
export function getAppBaseUrl(): string | null {
  const raw = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_STORE_URL || process.env.NEXT_PUBLIC_SITE_URL || "").trim();
  if (!/^https?:\/\/[^\s]+$/i.test(raw)) return null;
  return raw.replace(/\/+$/, "");
}
