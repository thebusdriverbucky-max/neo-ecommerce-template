import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || "",
  token: process.env.UPSTASH_REDIS_REST_TOKEN || "",
});

/**
 * Helper to prefix Redis keys
 */
export const redisKey = (key: string) => `e-commerce:${key}`;
