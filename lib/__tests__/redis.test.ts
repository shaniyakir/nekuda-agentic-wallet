/**
 * Redis client module test.
 *
 * Verifies the redis singleton is properly exported and has the expected interface.
 * Does NOT require a live Redis connection — we mock the client for unit tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockConstructorArgs: unknown[] = [];

class MockRedis {
  get = vi.fn();
  set = vi.fn();
  del = vi.fn();
  keys = vi.fn();
  mget = vi.fn();
  expire = vi.fn();

  constructor(args: unknown) {
    mockConstructorArgs.push(args);
  }
}

vi.mock("@upstash/redis", () => ({
  Redis: MockRedis,
}));

describe("redis client", () => {
  beforeEach(() => {
    vi.resetModules();
    mockConstructorArgs.length = 0;
  });

  it("exports a redis singleton with expected methods", async () => {
    const { redis } = await import("@/lib/redis");

    expect(redis).toBeDefined();
    expect(typeof redis.get).toBe("function");
    expect(typeof redis.set).toBe("function");
    expect(typeof redis.del).toBe("function");
  });

  it("creates Redis client with KV_REST_API env vars", async () => {
    await import("@/lib/redis");

    expect(mockConstructorArgs.length).toBeGreaterThan(0);
    expect(mockConstructorArgs[0]).toEqual({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
  });
});
