import { Redis } from "@upstash/redis";

const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

// Upstash is optional when the documented external WAF limiter is enabled.
// Never initialize the provider SDK with empty or partial credentials.
export const redis = (() => {
  if (!url || !token) return null;

  try {
    return new Redis({ url, token });
  } catch {
    return null;
  }
})();

/**
 * Helper to prefix Redis keys
 */
export const redisKey = (key: string) => `e-commerce:${key}`;
