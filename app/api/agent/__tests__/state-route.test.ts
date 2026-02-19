import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetAuthSession = vi.fn();
const mockGetSession = vi.fn();

vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetAuthSession(),
}));

vi.mock("@/lib/agent/session-store", () => ({
  getSession: (id: string) => mockGetSession(id),
}));

import { GET } from "@/app/api/agent/state/[sessionId]/route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(): Request {
  return new Request("http://localhost:3000/api/agent/state/test-session", {
    method: "GET",
  });
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

  it("returns 401 when not authenticated", async () => {
    mockGetAuthSession.mockResolvedValue({ userId: null });

    const res = await GET(makeRequest(), makeParams("s1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when session does not exist", async () => {
    mockGetAuthSession.mockResolvedValue({ userId: "u@test.com" });
    mockGetSession.mockReturnValue(null);

    const res = await GET(makeRequest(), makeParams("nonexistent"));
    expect(res.status).toBe(404);
    expect(mockGetSession).toHaveBeenCalledWith("nonexistent");
  });

  it("returns 403 when session belongs to different user", async () => {
    mockGetAuthSession.mockResolvedValue({ userId: "u@test.com" });
    mockGetSession.mockReturnValue({
      sessionId: "s1",
      userId: "other@user.com",
      cartId: null,
    });

    const res = await GET(makeRequest(), makeParams("s1"));
    expect(res.status).toBe(403);
  });

  it("returns session state when authorized", async () => {
    const sessionState = {
      sessionId: "s1",
      userId: "u@test.com",
      cartId: "cart_123",
      cartStatus: "active",
      cartTotal: 89.99,
      checkoutId: null,
      mandateId: null,
      mandateStatus: null,
      revealTokenObtained: false,
      credentialsRevealed: false,
      credentialsRevealedAt: null,
      orderId: null,
      stripePaymentIntentId: null,
      paymentStatus: null,
      error: null,
      updatedAt: "2026-02-19T10:00:00.000Z",
    };

    mockGetAuthSession.mockResolvedValue({ userId: "u@test.com" });
    mockGetSession.mockReturnValue(sessionState);

    const res = await GET(makeRequest(), makeParams("s1"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.sessionId).toBe("s1");
    expect(body.userId).toBe("u@test.com");
    expect(body.cartId).toBe("cart_123");
    expect(body.cartTotal).toBe(89.99);
  });
});
