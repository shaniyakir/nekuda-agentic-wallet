/**
 * Tests for auth security hardening:
 * - getTokenSecret() must throw when SESSION_SECRET is missing
 * - Token generation/verification require SESSION_SECRET
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("auth — token secret enforcement", () => {
  const originalEnv = process.env.SESSION_SECRET;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.SESSION_SECRET = originalEnv;
    }
    vi.resetModules();
  });

  it("auth module refuses to load when SESSION_SECRET is missing", async () => {
    delete process.env.SESSION_SECRET;
    await expect(() => import("@/lib/auth")).rejects.toThrow("SESSION_SECRET");
  });

  it("generateMagicToken succeeds when SESSION_SECRET is set", async () => {
    process.env.SESSION_SECRET = "test-secret-at-least-32-chars-long!!";
    const { generateMagicToken } = await import("@/lib/auth");
    const token = generateMagicToken("test@test.com");
    expect(token).toBeTruthy();
    expect(token.split(".")).toHaveLength(3);
  });

  it("tokens signed with one secret do not verify with another", async () => {
    process.env.SESSION_SECRET = "secret-one-at-least-32-characters!!";
    const mod1 = await import("@/lib/auth");
    const token = mod1.generateMagicToken("test@test.com");

    vi.resetModules();
    process.env.SESSION_SECRET = "secret-two-totally-different-value!!";
    const mod2 = await import("@/lib/auth");
    const result = mod2.verifyMagicToken(token);
    expect(result).toBeNull();
  });
});

describe("auth — session store does not leak sensitive data", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("session creation does not log the user email in plain text to console", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { getOrCreateSession, deleteSession } = await import("@/lib/agent/session-store");

    getOrCreateSession("test-session", "secret@example.com");

    const logOutput = consoleSpy.mock.calls.map((c) => c.join(" ")).join(" ");
    expect(logOutput).not.toContain("secret@example.com");

    deleteSession("test-session");
    consoleSpy.mockRestore();
  });
});
