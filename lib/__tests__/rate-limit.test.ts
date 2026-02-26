/**
 * Rate limiter module test.
 *
 * Verifies the rate limiter is properly configured and helper functions work.
 * Uses mocked Redis to avoid hitting a real Upstash instance.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@upstash/redis", () => {
  class MockRedis {
    get = vi.fn();
    set = vi.fn();
    eval = vi.fn();
    evalsha = vi.fn();
    scriptLoad = vi.fn();
  }
  return { Redis: MockRedis };
});

vi.mock("@upstash/ratelimit", () => {
  const mockLimit = vi.fn();
  class MockRatelimit {
    limit = mockLimit;
    static slidingWindow = vi.fn().mockReturnValue({ type: "slidingWindow" });
  }
  return {
    Ratelimit: MockRatelimit,
    __mockLimit: mockLimit,
  };
});

describe("rate-limit module", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("exports agentRateLimiter with limit method", async () => {
    const { agentRateLimiter } = await import("@/lib/rate-limit");
    expect(agentRateLimiter).toBeDefined();
    expect(typeof agentRateLimiter.limit).toBe("function");
  });

  it("getRetryAfterSeconds returns 0 for successful results", async () => {
    const { getRetryAfterSeconds } = await import("@/lib/rate-limit");
    const result = { success: true, reset: Date.now() + 60_000, remaining: 9, limit: 10, pending: Promise.resolve() };
    expect(getRetryAfterSeconds(result)).toBe(0);
  });

  it("getRetryAfterSeconds calculates seconds until reset for failed results", async () => {
    const { getRetryAfterSeconds } = await import("@/lib/rate-limit");
    const resetTime = Date.now() + 30_000;
    const result = { success: false, reset: resetTime, remaining: 0, limit: 10, pending: Promise.resolve() };
    const seconds = getRetryAfterSeconds(result);
    expect(seconds).toBeGreaterThanOrEqual(29);
    expect(seconds).toBeLessThanOrEqual(31);
  });

  it("getRetryAfterSeconds returns at least 1 second", async () => {
    const { getRetryAfterSeconds } = await import("@/lib/rate-limit");
    const result = { success: false, reset: Date.now() - 1000, remaining: 0, limit: 10, pending: Promise.resolve() };
    expect(getRetryAfterSeconds(result)).toBe(1);
  });
});
