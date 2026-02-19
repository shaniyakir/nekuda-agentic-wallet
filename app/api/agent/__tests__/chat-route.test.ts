import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be defined before any imports that reference them
// ---------------------------------------------------------------------------

const mockGetSession = vi.fn();
const mockRateLimiterCheck = vi.fn();
const mockStreamText = vi.fn();
const mockGetOrCreateSession = vi.fn();

vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

vi.mock("@/lib/rate-limit", () => ({
  agentRateLimiter: { check: (key: string) => mockRateLimiterCheck(key) },
}));

vi.mock("ai", () => ({
  streamText: (opts: unknown) => mockStreamText(opts),
  stepCountIs: (n: number) => ({ type: "stepCount", count: n }),
  convertToModelMessages: (msgs: unknown[]) => Promise.resolve(msgs),
}));

vi.mock("@ai-sdk/openai", () => ({
  openai: (model: string) => ({ provider: "openai", model }),
}));

vi.mock("@/lib/agent/tools", () => ({
  createToolSet: (meta: { sessionId: string; userId: string }) => ({
    _meta: meta,
  }),
}));

vi.mock("@/lib/agent/system-prompt", () => ({
  SYSTEM_PROMPT: "test-system-prompt",
}));

vi.mock("@/lib/agent/session-store", () => ({
  getOrCreateSession: (...args: unknown[]) => mockGetOrCreateSession(...args),
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { POST } from "@/app/api/agent/chat/route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/agent/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const fakeStreamResponse = new Response("streamed", { status: 200 });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/agent/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrCreateSession.mockReturnValue({ sessionId: "s1", userId: "u@test.com" });
    mockStreamText.mockReturnValue({
      toUIMessageStreamResponse: () => fakeStreamResponse,
    });
  });

  it("returns 401 when no session", async () => {
    mockGetSession.mockResolvedValue({ userId: null });

    const res = await POST(makeRequest({ messages: [{ role: "user", content: "hi" }] }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("Unauthorized");
  });

  it("returns 429 when rate limited", async () => {
    mockGetSession.mockResolvedValue({ userId: "u@test.com" });
    mockRateLimiterCheck.mockReturnValue({
      allowed: false,
      retryAfterSeconds: 42,
      remaining: 0,
    });

    const res = await POST(makeRequest({ messages: [{ role: "user", content: "hi" }] }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
  });

  it("returns 400 for invalid JSON body", async () => {
    mockGetSession.mockResolvedValue({ userId: "u@test.com" });
    mockRateLimiterCheck.mockReturnValue({ allowed: true, retryAfterSeconds: 0, remaining: 9 });

    const badReq = new Request("http://localhost:3000/api/agent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });

    const res = await POST(badReq);
    expect(res.status).toBe(400);
  });

  it("returns 400 for empty messages array", async () => {
    mockGetSession.mockResolvedValue({ userId: "u@test.com" });
    mockRateLimiterCheck.mockReturnValue({ allowed: true, retryAfterSeconds: 0, remaining: 9 });

    const res = await POST(makeRequest({ messages: [] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("No messages");
  });

  it("creates session and streams response for valid request", async () => {
    mockGetSession.mockResolvedValue({ userId: "u@test.com" });
    mockRateLimiterCheck.mockReturnValue({ allowed: true, retryAfterSeconds: 0, remaining: 8 });

    const res = await POST(
      makeRequest({
        id: "session_123",
        messages: [{ id: "m1", role: "user", content: "show me products" }],
      })
    );

    expect(res.status).toBe(200);
    expect(mockGetOrCreateSession).toHaveBeenCalledWith("session_123", "u@test.com");
    expect(mockStreamText).toHaveBeenCalledTimes(1);

    const streamOpts = mockStreamText.mock.calls[0][0];
    expect(streamOpts.system).toBe("test-system-prompt");
    expect(streamOpts.model).toEqual({ provider: "openai", model: "gpt-4o" });
    expect(streamOpts.experimental_telemetry.isEnabled).toBe(true);
    expect(streamOpts.experimental_telemetry.metadata.userId).toBe("u@test.com");
  });

  it("generates a sessionId when none provided", async () => {
    mockGetSession.mockResolvedValue({ userId: "u@test.com" });
    mockRateLimiterCheck.mockReturnValue({ allowed: true, retryAfterSeconds: 0, remaining: 8 });

    await POST(
      makeRequest({
        messages: [{ id: "m1", role: "user", content: "hello" }],
      })
    );

    const callArgs = mockGetOrCreateSession.mock.calls[0];
    expect(callArgs[0]).toMatch(/^agent_u@test\.com_\d+$/);
    expect(callArgs[1]).toBe("u@test.com");
  });

  it("passes session-scoped tools to streamText", async () => {
    mockGetSession.mockResolvedValue({ userId: "u@test.com" });
    mockRateLimiterCheck.mockReturnValue({ allowed: true, retryAfterSeconds: 0, remaining: 8 });

    await POST(
      makeRequest({
        id: "s1",
        messages: [{ id: "m1", role: "user", content: "hi" }],
      })
    );

    const streamOpts = mockStreamText.mock.calls[0][0];
    expect(streamOpts.tools._meta).toEqual({
      sessionId: "s1",
      userId: "u@test.com",
    });
  });

  it("uses rate limiter keyed by userId", async () => {
    mockGetSession.mockResolvedValue({ userId: "specific@user.com" });
    mockRateLimiterCheck.mockReturnValue({ allowed: true, retryAfterSeconds: 0, remaining: 8 });

    await POST(
      makeRequest({
        messages: [{ id: "m1", role: "user", content: "hi" }],
      })
    );

    expect(mockRateLimiterCheck).toHaveBeenCalledWith("specific@user.com");
  });
});
