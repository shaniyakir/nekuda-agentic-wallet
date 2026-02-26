import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  NekudaApiError,
  CardNotFoundError,
  AuthenticationError,
  NekudaConnectionError,
  NekudaValidationError,
} from "@nekuda/nekuda-js";

// ---------------------------------------------------------------------------
// Mock Redis (before any imports that use it)
// ---------------------------------------------------------------------------

const mockStore = new Map<string, unknown>();

vi.mock("@upstash/redis", () => {
  class MockRedis {
    get = vi.fn((key: string) => Promise.resolve(mockStore.get(key) ?? null));
    set = vi.fn((key: string, value: unknown) => {
      mockStore.set(key, value);
      return Promise.resolve("OK");
    });
    del = vi.fn((key: string) => {
      const existed = mockStore.has(key);
      mockStore.delete(key);
      return Promise.resolve(existed ? 1 : 0);
    });
    keys = vi.fn((pattern: string) => {
      const prefix = pattern.replace("*", "");
      return Promise.resolve(
        Array.from(mockStore.keys()).filter((k) => k.startsWith(prefix))
      );
    });
    mget = vi.fn((...keys: string[]) =>
      Promise.resolve(keys.map((k) => mockStore.get(k) ?? null))
    );
  }
  return { Redis: MockRedis };
});

// ---------------------------------------------------------------------------
// Controllable mocks for Nekuda
// ---------------------------------------------------------------------------

const mockCreateMandate = vi.fn();
const mockRequestCardRevealToken = vi.fn();
const mockRevealCardDetails = vi.fn();
const mockGetBillingDetails = vi.fn();

vi.mock("@/lib/nekuda", () => ({
  nekuda: {
    user: () => ({
      createMandate: mockCreateMandate,
      requestCardRevealToken: mockRequestCardRevealToken,
      revealCardDetails: mockRevealCardDetails,
      getBillingDetails: mockGetBillingDetails,
    }),
  },
}));

// ---------------------------------------------------------------------------
// Mock Stripe (kept for createMandate tests that reference stripe module)
// ---------------------------------------------------------------------------

vi.mock("@/lib/stripe", () => ({
  stripe: {
    paymentIntents: { create: vi.fn() },
  },
}));

// ---------------------------------------------------------------------------
// Mock browser automation
// ---------------------------------------------------------------------------

const mockCompleteCheckoutViasBrowser = vi.fn();
const mockCloseBrowser = vi.fn();

vi.mock("@/lib/agent/browser", () => ({
  extractCardCredentials: vi.fn((card: any) => {
    if (card.isVisaPayment && card.visaCredentials) {
      const vc = card.visaCredentials;
      if (!vc.cardNumber || !vc.expiryMonth || !vc.expiryYear || !vc.cvv) {
        return { error: "Incomplete Visa credentials from Nekuda" };
      }
      return { number: vc.cardNumber, expiry: `${vc.expiryMonth}${vc.expiryYear}`, cvc: vc.cvv };
    }
    if (!card.cardNumber || !card.cardExpiryDate) {
      const missing = [!card.cardNumber && "cardNumber", !card.cardExpiryDate && "cardExpiryDate"]
        .filter(Boolean).join(", ");
      return { error: `Incomplete card data from Nekuda: missing ${missing}` };
    }
    return { number: card.cardNumber, expiry: card.cardExpiryDate.replace("/", ""), cvc: card.cardCvv ?? "" };
  }),
  completeCheckoutViasBrowser: (...args: unknown[]) => mockCompleteCheckoutViasBrowser(...args),
  closeBrowser: (...args: unknown[]) => mockCloseBrowser(...args),
}));

// ---------------------------------------------------------------------------
// Mock checkout token (requires SESSION_SECRET which isn't set in test env)
// ---------------------------------------------------------------------------

vi.mock("@/lib/agent/checkout-token", () => ({
  generateCheckoutToken: vi.fn().mockReturnValue("mock-checkout-token"),
  verifyCheckoutToken: vi.fn().mockReturnValue(true),
  CHECKOUT_TOKEN_COOKIE: "checkout_token",
}));

import { createToolSet } from "@/lib/agent/tools";
import {
  getOrCreateSession,
  getSession,
  deleteSession,
} from "@/lib/agent/session-store";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toolOpts = { toolCallId: "tc", messages: [] as never[], abortSignal: undefined as never };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function exec(t: { execute?: (...args: any[]) => any }, ...args: any[]): Promise<any> {
  return t.execute!(...args);
}

const MOCK_CARD = {
  cardNumber: "4111111111111111",
  cardExpiryDate: "12/28",
  cardCvv: "321",
  cardholderName: "Test User",
  last4Digits: "1111",
  isVisaPayment: false,
  billingAddress: null,
  zipCode: null,
};

const MOCK_BILLING = {
  userId: "pay@test.com",
  cardholderName: "Test User",
  phoneNumber: "+15551234567",
  billingAddress: "123 Main St",
  zipCode: "94102",
  city: "San Francisco",
  state: "CA",
};

// ---------------------------------------------------------------------------
// createMandate
// ---------------------------------------------------------------------------

describe("createMandate", () => {
  const sid = `mandate-${Date.now()}`;
  const uid = "mandate@test.com";
  let tools: ReturnType<typeof createToolSet>;

  async function setupCheckedOutCart() {
    const cart = await exec(tools.createCart, {}, toolOpts);
    await exec(tools.addToCart, { cartId: cart.cartId, productId: "prod_001", quantity: 1 }, toolOpts);
    const checkout = await exec(tools.checkoutCart, { cartId: cart.cartId }, toolOpts);
    return checkout.checkoutId as string;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    mockStore.clear();
    await deleteSession(sid);
    await getOrCreateSession(sid, uid);
    tools = createToolSet({ sessionId: sid, userId: uid });
  });

  it("returns mandateId on success using server-verified cart total", async () => {
    const checkoutId = await setupCheckedOutCart();
    mockCreateMandate.mockResolvedValue({ mandateId: 42, requestId: "req_abc" });

    const result = await exec(tools.createMandate, { checkoutId }, toolOpts);
    expect(result.mandateId).toBe(42);
    expect(result.status).toBe("approved");
    expect(result.amount).toBe("$89.99");
    expect(result.requestId).toBe("req_abc");

    const session = await getSession(sid);
    expect(session?.mandateId).toBe(42);
    expect(session?.mandateStatus).toBe("approved");
  });

  it("passes server-calculated price to Nekuda (not LLM input)", async () => {
    const checkoutId = await setupCheckedOutCart();
    mockCreateMandate.mockResolvedValue({ mandateId: 1, requestId: "r" });

    await exec(tools.createMandate, { checkoutId }, toolOpts);

    const mandateArg = mockCreateMandate.mock.calls[0][0];
    expect(mandateArg.price).toBe(89.99);
    expect(mandateArg.product).toContain("Wireless Headphones");
  });

  it("returns error for non-existent checkout", async () => {
    const result = await exec(tools.createMandate, { checkoutId: "nonexistent" }, toolOpts);
    expect(result.error).toContain("Checkout not found");
  });

  it("returns error for cart that is not checked out", async () => {
    const cart = await exec(tools.createCart, {}, toolOpts);
    await exec(tools.addToCart, { cartId: cart.cartId, productId: "prod_001", quantity: 1 }, toolOpts);

    const result = await exec(tools.createMandate, { checkoutId: cart.cartId }, toolOpts);
    expect(result.error).toContain("active");
  });

  it("returns NO_PAYMENT_METHOD on CardNotFoundError", async () => {
    const checkoutId = await setupCheckedOutCart();
    mockCreateMandate.mockRejectedValue(
      new CardNotFoundError("Card not found", "card_not_found", 404, "test@test.com")
    );

    const result = await exec(tools.createMandate, { checkoutId }, toolOpts);
    expect(result.error).toBe("NO_PAYMENT_METHOD");
    expect(result.message).toContain("Wallet");
    expect(result.retryable).toBe(false);

    const session = await getSession(sid);
    expect(session?.mandateStatus).toBe("failed");
  });

  it("returns NO_PAYMENT_METHOD on generic 400 with 'Unknown error' (SDK parsing gap)", async () => {
    const checkoutId = await setupCheckedOutCart();
    mockCreateMandate.mockRejectedValue(
      new NekudaApiError("Unknown error", "invalid_request", 400)
    );

    const result = await exec(tools.createMandate, { checkoutId }, toolOpts);
    expect(result.error).toBe("NO_PAYMENT_METHOD");
    expect(result.message).toContain("Wallet");
  });

  it("returns retryable error on 429 (rate limited)", async () => {
    const checkoutId = await setupCheckedOutCart();
    mockCreateMandate.mockRejectedValue(
      new NekudaApiError("Rate limit exceeded", "rate_limited", 429)
    );

    const result = await exec(tools.createMandate, { checkoutId }, toolOpts);
    expect(result.error).toContain("Rate limit exceeded");
    expect(result.retryable).toBe(true);
  });

  it("returns retryable error on 503 (service unavailable)", async () => {
    const checkoutId = await setupCheckedOutCart();
    mockCreateMandate.mockRejectedValue(
      new NekudaApiError("Service unavailable", "unavailable", 503)
    );

    const result = await exec(tools.createMandate, { checkoutId }, toolOpts);
    expect(result.retryable).toBe(true);
  });

  it("returns non-retryable error on 400 and updates session error", async () => {
    const checkoutId = await setupCheckedOutCart();
    mockCreateMandate.mockRejectedValue(
      new NekudaApiError("Invalid mandate data", "invalid_request", 400)
    );

    const result = await exec(tools.createMandate, { checkoutId }, toolOpts);
    expect(result.error).toContain("Invalid mandate data");
    expect(result.retryable).toBe(false);

    const session = await getSession(sid);
    expect(session?.error).toContain("Invalid mandate data");
  });

  it("returns non-retryable config error on AuthenticationError", async () => {
    const checkoutId = await setupCheckedOutCart();
    mockCreateMandate.mockRejectedValue(
      new AuthenticationError("Invalid API key", "authentication_error", 401)
    );

    const result = await exec(tools.createMandate, { checkoutId }, toolOpts);
    expect(result.error).toContain("configuration error");
    expect(result.retryable).toBe(false);

    const session = await getSession(sid);
    expect(session?.error).toBe("Payment service authentication failed");
  });

  it("returns retryable error on NekudaConnectionError", async () => {
    const checkoutId = await setupCheckedOutCart();
    mockCreateMandate.mockRejectedValue(
      new NekudaConnectionError("ECONNREFUSED")
    );

    const result = await exec(tools.createMandate, { checkoutId }, toolOpts);
    expect(result.error).toContain("Could not reach the payment service");
    expect(result.retryable).toBe(true);
  });

  it("returns non-retryable error on NekudaValidationError", async () => {
    const checkoutId = await setupCheckedOutCart();
    mockCreateMandate.mockRejectedValue(
      new NekudaValidationError("price must be positive")
    );

    const result = await exec(tools.createMandate, { checkoutId }, toolOpts);
    expect(result.error).toContain("price must be positive");
    expect(result.retryable).toBe(false);

    const session = await getSession(sid);
    expect(session?.error).toContain("price must be positive");
  });

  it("handles unexpected non-Nekuda errors", async () => {
    const checkoutId = await setupCheckedOutCart();
    mockCreateMandate.mockRejectedValue(new Error("Network timeout"));

    const result = await exec(tools.createMandate, { checkoutId }, toolOpts);
    expect(result.error).toContain("Network timeout");
    expect(result.retryable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// completeCheckout — browser-use payment flow
// ---------------------------------------------------------------------------

describe("completeCheckout", () => {
  const sid = `checkout-${Date.now()}`;
  const uid = "pay@test.com";
  let tools: ReturnType<typeof createToolSet>;

  async function setupCheckedOutCart() {
    const cart = await exec(tools.createCart, {}, toolOpts);
    await exec(tools.addToCart, { cartId: cart.cartId, productId: "prod_001", quantity: 1 }, toolOpts);
    const checkout = await exec(tools.checkoutCart, { cartId: cart.cartId }, toolOpts);
    return checkout.checkoutId as string;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    mockStore.clear();
    await deleteSession(sid);
    await getOrCreateSession(sid, uid);
    tools = createToolSet({ sessionId: sid, userId: uid });
  });

  it("completes full checkout via browser automation", async () => {
    const checkoutId = await setupCheckedOutCart();
    mockRequestCardRevealToken.mockResolvedValue({ revealToken: "tok_abc" });
    mockRevealCardDetails.mockResolvedValue(MOCK_CARD);
    mockGetBillingDetails.mockResolvedValue(MOCK_BILLING);
    mockCompleteCheckoutViasBrowser.mockResolvedValue({
      success: true,
      orderId: checkoutId,
      stripePaymentIntentId: "pi_test_456",
      amount: "$89.99",
      status: "succeeded",
    });

    const result = await exec(tools.completeCheckout, { checkoutId, mandateId: 42 }, toolOpts);

    expect(result.success).toBe(true);
    expect(result.orderId).toBe(checkoutId);
    expect(result.stripePaymentIntentId).toBe("pi_test_456");
    expect(result.last4).toBe("1111");
    expect(result.status).toBe("succeeded");

    // Card data never returned to LLM
    expect(result).not.toHaveProperty("cardNumber");
    expect(result).not.toHaveProperty("cvv");
    expect(result).not.toHaveProperty("cvc");

    const session = await getSession(sid);
    expect(session?.browserCheckoutStatus).toBe("completed");
    expect(session?.paymentStatus).toBe("succeeded");
  });

  it("passes card credentials and billing to browser automation", async () => {
    const checkoutId = await setupCheckedOutCart();
    mockRequestCardRevealToken.mockResolvedValue({ revealToken: "tok_abc" });
    mockRevealCardDetails.mockResolvedValue(MOCK_CARD);
    mockGetBillingDetails.mockResolvedValue(MOCK_BILLING);
    mockCompleteCheckoutViasBrowser.mockResolvedValue({ success: true, orderId: checkoutId });

    await exec(tools.completeCheckout, { checkoutId, mandateId: 42 }, toolOpts);

    expect(mockCompleteCheckoutViasBrowser).toHaveBeenCalledWith(
      expect.objectContaining({
        checkoutId,
        billing: MOCK_BILLING,
        email: uid,
        card: expect.objectContaining({
          number: "4111111111111111",
          cvc: "321",
        }),
      })
    );
  });

  it("returns INCOMPLETE_CARD_DATA when card number is missing", async () => {
    const checkoutId = await setupCheckedOutCart();
    mockRequestCardRevealToken.mockResolvedValue({ revealToken: "tok_abc" });
    mockRevealCardDetails.mockResolvedValue({ ...MOCK_CARD, cardNumber: null });

    const result = await exec(tools.completeCheckout, { checkoutId, mandateId: 42 }, toolOpts);

    expect(result.error).toBe("INCOMPLETE_CARD_DATA");
    expect(result.message).toContain("cardNumber");
    expect(result.retryable).toBe(true);
    expect(mockCompleteCheckoutViasBrowser).not.toHaveBeenCalled();
  });

  it("returns CVV_EXPIRED on CVV expired error from Nekuda", async () => {
    const checkoutId = await setupCheckedOutCart();
    mockRequestCardRevealToken.mockResolvedValue({ revealToken: "tok_abc" });
    mockRevealCardDetails.mockRejectedValue(
      new NekudaApiError("Card CVV has expired", "cvv_expired", 400)
    );

    const result = await exec(tools.completeCheckout, { checkoutId, mandateId: 42 }, toolOpts);

    expect(result.error).toBe("CVV_EXPIRED");
    expect(result.action).toBe("collect_cvv");
    expect(result.message).toContain("wallet page");

    const session = await getSession(sid);
    expect(session?.browserCheckoutStatus).toBe("cvv_expired");
  });

  it("returns error when browser checkout fails (e.g. card declined)", async () => {
    const checkoutId = await setupCheckedOutCart();
    mockRequestCardRevealToken.mockResolvedValue({ revealToken: "tok_abc" });
    mockRevealCardDetails.mockResolvedValue(MOCK_CARD);
    mockGetBillingDetails.mockResolvedValue(MOCK_BILLING);
    mockCompleteCheckoutViasBrowser.mockResolvedValue({
      success: false,
      error: "Your card was declined.",
    });

    const result = await exec(tools.completeCheckout, { checkoutId, mandateId: 42 }, toolOpts);

    expect(result.error).toBe("Your card was declined.");
    expect(result.retryable).toBe(true);

    const session = await getSession(sid);
    expect(session?.paymentStatus).toBe("failed");
    expect(session?.browserCheckoutStatus).toBe("failed");
  });

  it("returns retryable error when reveal token request fails with 429", async () => {
    const checkoutId = await setupCheckedOutCart();
    mockRequestCardRevealToken.mockRejectedValue(
      new NekudaApiError("Too many requests", "rate_limited", 429)
    );

    const result = await exec(tools.completeCheckout, { checkoutId, mandateId: 42 }, toolOpts);

    expect(result.error).toContain("Too many requests");
    expect(result.retryable).toBe(true);
    expect(mockCompleteCheckoutViasBrowser).not.toHaveBeenCalled();
  });

  it("returns config error on AuthenticationError during token request", async () => {
    const checkoutId = await setupCheckedOutCart();
    mockRequestCardRevealToken.mockRejectedValue(
      new AuthenticationError("Unauthorized", "authentication_error", 401)
    );

    const result = await exec(tools.completeCheckout, { checkoutId, mandateId: 42 }, toolOpts);

    expect(result.error).toContain("configuration error");
    expect(result.retryable).toBe(false);
  });

  it("returns retryable error on NekudaConnectionError during billing fetch", async () => {
    const checkoutId = await setupCheckedOutCart();
    mockRequestCardRevealToken.mockResolvedValue({ revealToken: "tok_abc" });
    mockRevealCardDetails.mockResolvedValue(MOCK_CARD);
    mockGetBillingDetails.mockRejectedValue(
      new NekudaConnectionError("ETIMEDOUT")
    );

    const result = await exec(tools.completeCheckout, { checkoutId, mandateId: 42 }, toolOpts);

    expect(result.error).toContain("Could not reach the payment service");
    expect(result.retryable).toBe(true);
    expect(mockCompleteCheckoutViasBrowser).not.toHaveBeenCalled();
  });

  it("handles browser automation crash gracefully", async () => {
    const checkoutId = await setupCheckedOutCart();
    mockRequestCardRevealToken.mockResolvedValue({ revealToken: "tok_abc" });
    mockRevealCardDetails.mockResolvedValue(MOCK_CARD);
    mockGetBillingDetails.mockResolvedValue(MOCK_BILLING);
    mockCompleteCheckoutViasBrowser.mockRejectedValue(
      new Error("Browser process terminated unexpectedly")
    );

    const result = await exec(tools.completeCheckout, { checkoutId, mandateId: 42 }, toolOpts);

    expect(result.error).toContain("Browser process terminated unexpectedly");
    expect(result.retryable).toBe(true);

    const session = await getSession(sid);
    expect(session?.browserCheckoutStatus).toBe("failed");
  });

  it("always closes browser even on failure", async () => {
    const checkoutId = await setupCheckedOutCart();
    mockRequestCardRevealToken.mockResolvedValue({ revealToken: "tok_abc" });
    mockRevealCardDetails.mockResolvedValue(MOCK_CARD);
    mockGetBillingDetails.mockResolvedValue(MOCK_BILLING);
    mockCompleteCheckoutViasBrowser.mockRejectedValue(new Error("crash"));

    await exec(tools.completeCheckout, { checkoutId, mandateId: 42 }, toolOpts);

    expect(mockCloseBrowser).toHaveBeenCalled();
  });

  it("tracks browserCheckoutStatus through the lifecycle", async () => {
    const checkoutId = await setupCheckedOutCart();
    mockRequestCardRevealToken.mockResolvedValue({ revealToken: "tok_abc" });
    mockRevealCardDetails.mockResolvedValue(MOCK_CARD);
    mockGetBillingDetails.mockResolvedValue(MOCK_BILLING);
    mockCompleteCheckoutViasBrowser.mockResolvedValue({
      success: true,
      orderId: checkoutId,
    });

    await exec(tools.completeCheckout, { checkoutId, mandateId: 42 }, toolOpts);

    const session = await getSession(sid);
    expect(session?.browserCheckoutStatus).toBe("completed");
  });

  it("prefers Visa DPAN credentials when available", async () => {
    const checkoutId = await setupCheckedOutCart();
    const visaCard = {
      ...MOCK_CARD,
      isVisaPayment: true,
      visaCredentials: {
        cardNumber: "4000000000003063",
        expiryMonth: "08",
        expiryYear: "28",
        cvv: "456",
      },
    };

    mockRequestCardRevealToken.mockResolvedValue({ revealToken: "tok_abc" });
    mockRevealCardDetails.mockResolvedValue(visaCard);
    mockGetBillingDetails.mockResolvedValue(MOCK_BILLING);
    mockCompleteCheckoutViasBrowser.mockResolvedValue({ success: true, orderId: checkoutId });

    await exec(tools.completeCheckout, { checkoutId, mandateId: 42 }, toolOpts);

    expect(mockCompleteCheckoutViasBrowser).toHaveBeenCalledWith(
      expect.objectContaining({
        card: { number: "4000000000003063", expiry: "0828", cvc: "456" },
      })
    );
  });
});
