/**
 * In-memory sliding-window rate limiter.
 *
 * Keyed by userId (not IP) since userId is the meaningful identity
 * in our encrypted-session architecture.
 *
 * Returns standard 429 info with Retry-After seconds.
 *
 * Usage:
 *   const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 10 });
 *   const result = limiter.check(userId);
 *   if (!result.allowed) → respond with 429, Retry-After: result.retryAfterSeconds
 */

import { createLogger } from "@/lib/logger";

const log = createLogger("RATE_LIMIT");

interface RateLimiterConfig {
  /** Time window in milliseconds */
  windowMs: number;
  /** Max requests allowed within the window */
  maxRequests: number;
}

interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the oldest request in the window expires (only set when !allowed) */
  retryAfterSeconds: number;
  /** How many requests remain in the current window */
  remaining: number;
}

interface RateLimiter {
  check(key: string): RateLimitResult;
  /** Reset a specific key (useful for testing) */
  reset(key: string): void;
}

/**
 * Create a sliding-window rate limiter.
 * Stores timestamps of recent requests per key and prunes expired entries on each check.
 */
export function createRateLimiter(config: RateLimiterConfig): RateLimiter {
  const { windowMs, maxRequests } = config;
  const store = new Map<string, number[]>();

  function prune(key: string, now: number): number[] {
    const timestamps = store.get(key) ?? [];
    const cutoff = now - windowMs;
    const valid = timestamps.filter((t) => t > cutoff);
    store.set(key, valid);
    return valid;
  }

  return {
    check(key: string): RateLimitResult {
      const now = Date.now();
      const timestamps = prune(key, now);

      if (timestamps.length >= maxRequests) {
        const oldestInWindow = timestamps[0];
        const retryAfterMs = oldestInWindow + windowMs - now;
        const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);

        log.warn("Rate limit exceeded", { key, count: timestamps.length });

        return {
          allowed: false,
          retryAfterSeconds: Math.max(retryAfterSeconds, 1),
          remaining: 0,
        };
      }

      timestamps.push(now);
      store.set(key, timestamps);

      return {
        allowed: true,
        retryAfterSeconds: 0,
        remaining: maxRequests - timestamps.length,
      };
    },

    reset(key: string): void {
      store.delete(key);
    },
  };
}

// ---------------------------------------------------------------------------
// Default agent rate limiter instance (10 requests / 60 seconds per userId)
// ---------------------------------------------------------------------------

export const agentRateLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 10,
});
