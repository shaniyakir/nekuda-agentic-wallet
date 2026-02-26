/**
 * Redis client module test.
 *
 * Verifies the redis singleton is properly exported and has the expected interface.
 * Does NOT require a live Redis connection — we mock the client for unit tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@upstash/redis", () => ({
  Redis: {
    fromEnv: vi.fn(() => ({
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
      keys: vi.fn(),
      mget: vi.fn(),
      expire: vi.fn(),
    })),
  },
}));

describe("redis client", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("exports a redis singleton with expected methods", async () => {
    const { redis } = await import("@/lib/redis");

    expect(redis).toBeDefined();
    expect(typeof redis.get).toBe("function");
    expect(typeof redis.set).toBe("function");
    expect(typeof redis.del).toBe("function");
  });

  it("uses Redis.fromEnv() to create the client", async () => {
    const { Redis } = await import("@upstash/redis");
    await import("@/lib/redis");

    expect(Redis.fromEnv).toHaveBeenCalled();
  });
});
