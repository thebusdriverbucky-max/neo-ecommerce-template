import { Ratelimit } from "@upstash/ratelimit";
import { redis } from "./redis";

export const rateLimits = {
  // Reviews: 10 requests per hour
  reviews: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, "1 h"),
    analytics: true,
    prefix: "e-commerce:@upstash/ratelimit/reviews",
  }),

  // Forgot Password: 3 requests per hour
  forgotPassword: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(3, "1 h"),
    analytics: true,
    prefix: "e-commerce:@upstash/ratelimit/forgot-password",
  }),

  // Contact Form: 5 requests per hour
  contact: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, "1 h"),
    analytics: true,
    prefix: "e-commerce:@upstash/ratelimit/contact",
  }),

  // Coupons/Discounts: 15 requests per hour
  coupons: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(15, "1 h"),
    analytics: true,
    prefix: "e-commerce:@upstash/ratelimit/coupons",
  }),

  // Wishlist: 100 requests per hour
  wishlist: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(100, "1 h"),
    analytics: true,
    prefix: "e-commerce:@upstash/ratelimit/wishlist",
  }),

  // Admin API: 100 requests per minute
  admin: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(100, "1 m"),
    analytics: true,
    prefix: "e-commerce:@upstash/ratelimit/admin",
  }),

  // Orders: 50 requests per minute
  orders: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(50, "1 m"),
    analytics: true,
    prefix: "e-commerce:@upstash/ratelimit/orders",
  }),

  // Auth (Register/Login): 5 requests per minute
  auth: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, "1 m"),
    analytics: true,
    prefix: "e-commerce:@upstash/ratelimit/auth",
  }),
};

export type RateLimitType = keyof typeof rateLimits;

export async function checkRateLimit(
  identifier: string,
  type: RateLimitType
) {
  const limiter = rateLimits[type];

  if (!limiter) {
    return { success: true, remaining: 999, limit: 999, reset: 0 };
  }

  return await limiter.limit(identifier);
}
