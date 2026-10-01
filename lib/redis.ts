import { Redis } from "@upstash/redis";

const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
// Missing/invalid optional configuration must not initialize the provider.
export const redis = (() => {
  if (!url || !token) return null;
  try { return new Redis({ url, token }); } catch { return null; }
})();

/**
 * Helper to prefix Redis keys
 */
export const redisKey = (key: string) => `e-commerce:${key}`;
