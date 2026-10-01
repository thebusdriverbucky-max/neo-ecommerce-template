import { Ratelimit } from "@upstash/ratelimit";
import { redis } from "./redis";
import { logger } from "./logger";

export type RateLimitResult = {
  success: boolean;
  remaining: number;
  limit: number;
  reset: number;
  unavailable?: boolean;
};

const policies = {
  reviews: [10, 3600000], forgotPassword: [3, 3600000], contact: [5, 3600000],
  coupons: [15, 3600000], wishlist: [100, 3600000], admin: [100, 60000],
  orders: [50, 60000], auth: [5, 60000],
} as const;
export type RateLimitType = keyof typeof policies;
export const rateLimits: Partial<Record<RateLimitType, Ratelimit>> = {};
const buckets = new Map<string, { count: number; reset: number }>();
const MAX_BUCKETS = 10000;

function unavailable(): RateLimitResult {
  return { success: false, remaining: 0, limit: 0, reset: Date.now() + 60000, unavailable: true };
}

export async function checkRateLimit(identifier: string, type: RateLimitType): Promise<RateLimitResult> {
  const policy = policies[type];
  if (!policy) return unavailable();
  const [limit, duration] = policy;
  const hasUrl = Boolean(process.env.UPSTASH_REDIS_REST_URL?.trim());
  const hasToken = Boolean(process.env.UPSTASH_REDIS_REST_TOKEN?.trim());
  if (hasUrl || hasToken) {
    if (!hasUrl || !hasToken || !redis) return unavailable();
    try {
      const limiter = rateLimits[type] ??= new Ratelimit({
        redis, limiter: Ratelimit.slidingWindow(limit, duration === 60000 ? "1 m" : "1 h"),
        analytics: false, prefix: `e-commerce:@upstash/ratelimit/${type}`,
      });
      return await limiter.limit(identifier);
    } catch {
      logger.error("Rate limiter unavailable", { type });
      return unavailable();
    }
  }

  // Optional-provider fallback is per-process, not a distributed abuse guarantee.
  // Multi-instance deployments should use Upstash or an external edge limiter.
  const now = Date.now();
  for (const [key, bucket] of buckets) if (bucket.reset <= now) buckets.delete(key);
  const key = `${type}:${identifier.slice(0, 256)}`;
  let bucket = buckets.get(key);
  if (!bucket) {
    if (buckets.size >= MAX_BUCKETS) return unavailable();
    bucket = { count: 0, reset: now + duration };
    buckets.set(key, bucket);
  }
  const success = bucket.count < limit;
  if (success) bucket.count++;
  return { success, remaining: Math.max(0, limit - bucket.count), limit, reset: bucket.reset };
}
