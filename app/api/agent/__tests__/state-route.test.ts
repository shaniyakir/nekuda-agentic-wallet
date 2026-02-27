import { describe, it, expect, vi, beforeEach } from "vitest";
import { hashSessionId } from "@/lib/logger";
import { hashUserIdForStorage } from "@/lib/agent/session-store";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetAuthSession = vi.fn();
const mockGetSession = vi.fn();

vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetAuthSession(),
}));

vi.mock("@/lib/agent/session-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent/session-store")>();
  return {
    ...actual,
    getSession: (id: string) => mockGetSession(id),
  };
});

import { GET } from "@/app/api/agent/state/[sessionId]/route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_EMAIL = "buyer@example.com";
const TEST_SESSION_ID = hashSessionId(TEST_EMAIL);

function makeRequest(): Request {
  return new Request(
    `http://localhost:3000/api/agent/state/${encodeURIComponent(TEST_SESSION_ID)}`,
    { method: "GET" }
  );
}

function makeParams(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/agent/state/[sessionId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses hashed sessionId that contains no PII", () => {
    expect(TEST_SESSION_ID).toMatch(/^agent_[0-9a-f]{12}$/);
    expect(TEST_SESSION_ID).not.toContain("buyer");
    expect(TEST_SESSION_ID).not.toContain("example");
    expect(TEST_SESSION_ID).not.toContain("@");
  });

  it("produces deterministic hashes for the same email", () => {
    expect(hashSessionId(TEST_EMAIL)).toBe(TEST_SESSION_ID);
    expect(hashSessionId(TEST_EMAIL)).toBe(hashSessionId(TEST_EMAIL));
  });

  it("produces different hashes for different emails", () => {
    expect(hashSessionId("alice@test.com")).not.toBe(hashSessionId("bob@test.com"));
  });

  it("returns 401 when not authenticated", async () => {
    mockGetAuthSession.mockResolvedValue({ userId: null });

    const res = await GET(makeRequest(), makeParams(TEST_SESSION_ID));
    expect(res.status).toBe(401);
  });

  it("returns 404 when session does not exist", async () => {
    mockGetAuthSession.mockResolvedValue({ userId: TEST_EMAIL });
    mockGetSession.mockReturnValue(null);

    const res = await GET(makeRequest(), makeParams(TEST_SESSION_ID));
    expect(res.status).toBe(404);
    expect(mockGetSession).toHaveBeenCalledWith(TEST_SESSION_ID);
  });

  it("returns 403 when session belongs to different user", async () => {
    mockGetAuthSession.mockResolvedValue({ userId: TEST_EMAIL });
    mockGetSession.mockReturnValue({
      sessionId: TEST_SESSION_ID,
      userId: hashUserIdForStorage("other@user.com"),
      cartId: null,
    });

    const res = await GET(makeRequest(), makeParams(TEST_SESSION_ID));
    expect(res.status).toBe(403);
  });

  it("returns session state when authorized", async () => {
    const sessionState = {
      sessionId: TEST_SESSION_ID,
      userId: hashUserIdForStorage(TEST_EMAIL),
      cartId: "cart_123",
      cartStatus: "active",
      cartTotal: 89.99,
      checkoutId: null,
      mandateId: null,
      mandateStatus: null,
      browserCheckoutStatus: null,
      orderId: null,
      stripePaymentIntentId: null,
      paymentStatus: null,
      error: null,
      updatedAt: "2026-02-19T10:00:00.000Z",
    };

    mockGetAuthSession.mockResolvedValue({ userId: TEST_EMAIL });
    mockGetSession.mockReturnValue(sessionState);

    const res = await GET(makeRequest(), makeParams(TEST_SESSION_ID));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.sessionId).toBe(TEST_SESSION_ID);
    expect(body.userId).toBe(hashUserIdForStorage(TEST_EMAIL));
    expect(body.cartId).toBe("cart_123");
    expect(body.cartTotal).toBe(89.99);
  });
});
