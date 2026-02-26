/**
 * Redis-backed sliding-window rate limiter using @upstash/ratelimit.
 *
 * Keyed by userId (not IP) since userId is the meaningful identity
 * in our encrypted-session architecture.
 *
 * Persists across serverless cold starts via Upstash Redis.
 *
 * Usage:
 *   const result = await agentRateLimiter.limit(userId);
 *   if (!result.success) → respond with 429, Retry-After calculated from reset
 */

import { Ratelimit } from "@upstash/ratelimit";
import { redis } from "@/lib/redis";
import { createLogger } from "@/lib/logger";

const log = createLogger("RATE_LIMIT");

/**
 * Agent rate limiter: 10 requests per 60 seconds per userId.
 * Uses sliding window algorithm for smooth rate limiting.
 */
export const agentRateLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "60 s"),
  prefix: "ratelimit:agent",
  analytics: true,
});

/**
 * Result type returned by agentRateLimiter.limit().
 * Re-exported for convenience.
 */
export type RateLimitResult = Awaited<ReturnType<typeof agentRateLimiter.limit>>;

/**
 * Helper to calculate Retry-After seconds from a rate limit result.
 */
export function getRetryAfterSeconds(result: RateLimitResult): number {
  if (result.success) return 0;
  const now = Date.now();
  const retryAfterMs = result.reset - now;
  return Math.max(Math.ceil(retryAfterMs / 1000), 1);
}

/**
 * Log a rate limit event (call after limit() for blocked requests).
 */
export function logRateLimitExceeded(key: string, result: RateLimitResult): void {
  log.warn("Rate limit exceeded", {
    key,
    remaining: result.remaining,
    resetAt: new Date(result.reset).toISOString(),
  });
}
