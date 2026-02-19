import { describe, it, expect, beforeEach, vi } from "vitest";
import { NekudaApiError } from "@nekuda/nekuda-js";

// ---------------------------------------------------------------------------
// Controllable mocks for Nekuda + Stripe
// ---------------------------------------------------------------------------

const mockCreateMandate = vi.fn();
const mockRequestCardRevealToken = vi.fn();
const mockRevealCardDetails = vi.fn();

vi.mock("@/lib/nekuda", () => ({
  nekuda: {
    user: () => ({
      createMandate: mockCreateMandate,
      requestCardRevealToken: mockRequestCardRevealToken,
      revealCardDetails: mockRevealCardDetails,
    }),
  },
}));

const mockPaymentMethodsCreate = vi.fn();
const mockPaymentIntentsCreate = vi.fn();

vi.mock("@/lib/stripe", () => ({
  stripe: {
    paymentMethods: { create: (...args: unknown[]) => mockPaymentMethodsCreate(...args) },
    paymentIntents: { create: (...args: unknown[]) => mockPaymentIntentsCreate(...args) },
  },
}));

import { createToolSet } from "@/lib/agent/tools";
import {
  getOrCreateSession,
  getSession,
  deleteSession,
  updateSession,
  storeCredentials,
  getCredentials,
  clearCredentials,
} from "@/lib/agent/session-store";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toolOpts = { toolCallId: "tc", messages: [] as never[], abortSignal: undefined as never };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function exec(t: { execute?: (...args: any[]) => any }, ...args: any[]): Promise<any> {
  return t.execute!(...args);
}

const MOCK_CREDS = {
  cardNumber: "4111111111111111",
  cardExpiry: "12/28",
  cvv: "321",
  cardholderName: "Test User",
  isVisaPayment: true,
  billingAddress: null,
  zipCode: null,
};

// ---------------------------------------------------------------------------
// createMandate
// ---------------------------------------------------------------------------

describe("createMandate", () => {
  const sid = `mandate-${Date.now()}`;
  const uid = "mandate@test.com";
  let tools: ReturnType<typeof createToolSet>;

  beforeEach(() => {
    vi.clearAllMocks();
    deleteSession(sid);
    getOrCreateSession(sid, uid);
    tools = createToolSet({ sessionId: sid, userId: uid });
  });

  it("returns mandateId on success and updates session", async () => {
    mockCreateMandate.mockResolvedValue({ mandateId: 42, requestId: "req_abc" });

    const result = await exec(tools.createMandate, { product: "Headphones", price: 89.99 }, toolOpts);
    expect(result.mandateId).toBe(42);
    expect(result.status).toBe("approved");
    expect(result.requestId).toBe("req_abc");

    const session = getSession(sid);
    expect(session?.mandateId).toBe(42);
    expect(session?.mandateStatus).toBe("approved");
  });

  it("returns retryable error on 429 (rate limited)", async () => {
    mockCreateMandate.mockRejectedValue(
      new NekudaApiError("Rate limit exceeded", "rate_limited", 429)
    );

    const result = await exec(tools.createMandate, { product: "X", price: 10 }, toolOpts);
    expect(result.error).toContain("Rate limit exceeded");
    expect(result.retryable).toBe(true);
  });

  it("returns retryable error on 503 (service unavailable)", async () => {
    mockCreateMandate.mockRejectedValue(
      new NekudaApiError("Service unavailable", "unavailable", 503)
    );

    const result = await exec(tools.createMandate, { product: "X", price: 10 }, toolOpts);
    expect(result.retryable).toBe(true);
  });

  it("returns non-retryable error on 400 and updates session error", async () => {
    mockCreateMandate.mockRejectedValue(
      new NekudaApiError("Invalid mandate data", "invalid_request", 400)
    );

    const result = await exec(tools.createMandate, { product: "X", price: 10 }, toolOpts);
    expect(result.error).toContain("Invalid mandate data");
    expect(result.retryable).toBe(false);

    const session = getSession(sid);
    expect(session?.error).toContain("Invalid mandate data");
  });

  it("handles unexpected non-Nekuda errors", async () => {
    mockCreateMandate.mockRejectedValue(new Error("Network timeout"));

    const result = await exec(tools.createMandate, { product: "X", price: 10 }, toolOpts);
    expect(result.error).toContain("Network timeout");
    expect(result.retryable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// requestCardRevealToken
// ---------------------------------------------------------------------------

describe("requestCardRevealToken", () => {
  const sid = `reveal-${Date.now()}`;
  const uid = "reveal@test.com";
  let tools: ReturnType<typeof createToolSet>;

  beforeEach(() => {
    vi.clearAllMocks();
    deleteSession(sid);
    getOrCreateSession(sid, uid);
    tools = createToolSet({ sessionId: sid, userId: uid });
  });

  it("reveals card, stores in vault, returns only last4", async () => {
    mockRequestCardRevealToken.mockResolvedValue({ revealToken: "tok_abc" });
    mockRevealCardDetails.mockResolvedValue({
      cardNumber: "4111111111111111",
      cardExpiryDate: "12/28",
      cardCvv: "321",
      cardholderName: "Test User",
      last4Digits: "1111",
      isVisaPayment: true,
      billingAddress: null,
      zipCode: null,
    });

    const result = await exec(tools.requestCardRevealToken, { mandateId: 42 }, toolOpts);

    expect(result.success).toBe(true);
    expect(result.last4).toBe("1111");
    expect(result).not.toHaveProperty("cardNumber");
    expect(result).not.toHaveProperty("cvv");

    const creds = getCredentials(sid);
    expect(creds).not.toBeNull();
    expect(creds?.cardNumber).toBe("4111111111111111");
    expect(creds?.cvv).toBe("321");

    const session = getSession(sid);
    expect(session?.credentialsRevealed).toBe(true);
    expect(session?.credentialsRevealedAt).toBeTruthy();
    expect(session?.revealTokenObtained).toBe(true);

    clearCredentials(sid);
  });

  it("returns CVV_EXPIRED and clears session on CVV expired error", async () => {
    mockRequestCardRevealToken.mockResolvedValue({ revealToken: "tok_abc" });
    mockRevealCardDetails.mockRejectedValue(
      new NekudaApiError("Card CVV has expired", "cvv_expired", 400)
    );

    const result = await exec(tools.requestCardRevealToken, { mandateId: 42 }, toolOpts);

    expect(result.error).toBe("CVV_EXPIRED");
    expect(result.action).toBe("collect_cvv");
    expect(result.message).toContain("wallet page");

    const session = getSession(sid);
    expect(session?.credentialsRevealed).toBe(false);
    expect(session?.credentialsRevealedAt).toBeNull();
  });

  it("returns CVV_EXPIRED for invalid CVV variant", async () => {
    mockRequestCardRevealToken.mockResolvedValue({ revealToken: "tok_abc" });
    mockRevealCardDetails.mockRejectedValue(
      new NekudaApiError("CVV is invalid for this card", "invalid_cvv", 400)
    );

    const result = await exec(tools.requestCardRevealToken, { mandateId: 42 }, toolOpts);
    expect(result.error).toBe("CVV_EXPIRED");
  });

  it("returns retryable error on token request 429", async () => {
    mockRequestCardRevealToken.mockRejectedValue(
      new NekudaApiError("Too many requests", "rate_limited", 429)
    );

    const result = await exec(tools.requestCardRevealToken, { mandateId: 42 }, toolOpts);
    expect(result.error).toContain("Too many requests");
    expect(result.retryable).toBe(true);
  });

  it("returns non-retryable error on 404 (mandate not found)", async () => {
    mockRequestCardRevealToken.mockRejectedValue(
      new NekudaApiError("Mandate not found", "not_found", 404)
    );

    const result = await exec(tools.requestCardRevealToken, { mandateId: 999 }, toolOpts);
    expect(result.error).toContain("Mandate not found");
    expect(result.retryable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// executePayment — Stripe + credential TTL
// ---------------------------------------------------------------------------

describe("executePayment", () => {
  const sid = `pay-${Date.now()}`;
  const uid = "pay@test.com";
  let tools: ReturnType<typeof createToolSet>;

  async function setupCheckedOutCart() {
    const cart = await exec(tools.createCart, {}, toolOpts);
    await exec(tools.addToCart, { cartId: cart.cartId, productId: "prod_001", quantity: 1 }, toolOpts);
    const checkout = await exec(tools.checkoutCart, { cartId: cart.cartId }, toolOpts);
    return checkout.checkoutId as string;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    deleteSession(sid);
    getOrCreateSession(sid, uid);
    tools = createToolSet({ sessionId: sid, userId: uid });
  });

  it("succeeds end-to-end: Stripe payment + cart marked paid + creds cleared", async () => {
    const checkoutId = await setupCheckedOutCart();
    storeCredentials(sid, MOCK_CREDS);
    updateSession(sid, { credentialsRevealedAt: new Date().toISOString() });

    mockPaymentMethodsCreate.mockResolvedValue({ id: "pm_test_123" });
    mockPaymentIntentsCreate.mockResolvedValue({ id: "pi_test_456", status: "succeeded" });

    const result = await exec(tools.executePayment, { checkoutId }, toolOpts);

    expect(result.orderId).toBe(checkoutId);
    expect(result.stripePaymentIntentId).toBe("pi_test_456");
    expect(result.amount).toBe("$89.99");
    expect(result.status).toBe("succeeded");

    const session = getSession(sid);
    expect(session?.paymentStatus).toBe("succeeded");
    expect(session?.stripePaymentIntentId).toBe("pi_test_456");

    expect(getCredentials(sid)).toBeNull();
  });

  it("returns CREDENTIALS_EXPIRED when TTL exceeded (56 min)", async () => {
    const checkoutId = await setupCheckedOutCart();
    storeCredentials(sid, MOCK_CREDS);

    const fiftysixMinAgo = new Date(Date.now() - 56 * 60 * 1000).toISOString();
    updateSession(sid, { credentialsRevealedAt: fiftysixMinAgo });

    const result = await exec(tools.executePayment, { checkoutId }, toolOpts);

    expect(result.error).toBe("CREDENTIALS_EXPIRED");
    expect(result.message).toContain("requestCardRevealToken");
    expect(getCredentials(sid)).toBeNull();
  });

  it("allows payment within TTL window (54 min)", async () => {
    const checkoutId = await setupCheckedOutCart();
    storeCredentials(sid, MOCK_CREDS);

    const fiftyFourMinAgo = new Date(Date.now() - 54 * 60 * 1000).toISOString();
    updateSession(sid, { credentialsRevealedAt: fiftyFourMinAgo });

    mockPaymentMethodsCreate.mockResolvedValue({ id: "pm_ok" });
    mockPaymentIntentsCreate.mockResolvedValue({ id: "pi_ok", status: "succeeded" });

    const result = await exec(tools.executePayment, { checkoutId }, toolOpts);
    expect(result.status).toBe("succeeded");
  });

  it("returns error when Stripe declines the card", async () => {
    const checkoutId = await setupCheckedOutCart();
    storeCredentials(sid, MOCK_CREDS);
    updateSession(sid, { credentialsRevealedAt: new Date().toISOString() });

    mockPaymentMethodsCreate.mockResolvedValue({ id: "pm_test" });
    mockPaymentIntentsCreate.mockRejectedValue(new Error("Your card was declined."));

    const result = await exec(tools.executePayment, { checkoutId }, toolOpts);

    expect(result.error).toBe("Your card was declined.");

    const session = getSession(sid);
    expect(session?.paymentStatus).toBe("failed");
    expect(session?.error).toBe("Your card was declined.");
  });

  it("returns error when Stripe PaymentMethod creation fails", async () => {
    const checkoutId = await setupCheckedOutCart();
    storeCredentials(sid, MOCK_CREDS);
    updateSession(sid, { credentialsRevealedAt: new Date().toISOString() });

    mockPaymentMethodsCreate.mockRejectedValue(new Error("Your card number is incorrect."));

    const result = await exec(tools.executePayment, { checkoutId }, toolOpts);

    expect(result.error).toBe("Your card number is incorrect.");
    expect(getSession(sid)?.paymentStatus).toBe("failed");
  });

  it("returns error when Stripe reports insufficient funds", async () => {
    const checkoutId = await setupCheckedOutCart();
    storeCredentials(sid, MOCK_CREDS);
    updateSession(sid, { credentialsRevealedAt: new Date().toISOString() });

    mockPaymentMethodsCreate.mockResolvedValue({ id: "pm_test" });
    mockPaymentIntentsCreate.mockRejectedValue(
      new Error("Your card has insufficient funds.")
    );

    const result = await exec(tools.executePayment, { checkoutId }, toolOpts);
    expect(result.error).toBe("Your card has insufficient funds.");
    expect(getSession(sid)?.paymentStatus).toBe("failed");
  });

  it("returns error for cart that is already paid", async () => {
    const checkoutId = await setupCheckedOutCart();
    storeCredentials(sid, MOCK_CREDS);
    updateSession(sid, { credentialsRevealedAt: new Date().toISOString() });

    mockPaymentMethodsCreate.mockResolvedValue({ id: "pm_first" });
    mockPaymentIntentsCreate.mockResolvedValue({ id: "pi_first", status: "succeeded" });
    await exec(tools.executePayment, { checkoutId }, toolOpts);

    storeCredentials(sid, MOCK_CREDS);
    updateSession(sid, { credentialsRevealedAt: new Date().toISOString() });
    const result = await exec(tools.executePayment, { checkoutId }, toolOpts);

    expect(result.error).toContain("paid");
  });

  it("returns error for invalid card expiry format", async () => {
    const checkoutId = await setupCheckedOutCart();
    storeCredentials(sid, { ...MOCK_CREDS, cardExpiry: "invalid" });
    updateSession(sid, { credentialsRevealedAt: new Date().toISOString() });

    const result = await exec(tools.executePayment, { checkoutId }, toolOpts);
    expect(result.error).toContain("Invalid card expiry");
  });

  it("passes idempotency key to Stripe", async () => {
    const checkoutId = await setupCheckedOutCart();
    storeCredentials(sid, MOCK_CREDS);
    updateSession(sid, { credentialsRevealedAt: new Date().toISOString() });

    mockPaymentMethodsCreate.mockResolvedValue({ id: "pm_idem" });
    mockPaymentIntentsCreate.mockResolvedValue({ id: "pi_idem", status: "succeeded" });

    await exec(tools.executePayment, { checkoutId }, toolOpts);

    const [, opts] = mockPaymentIntentsCreate.mock.calls[0];
    expect(opts.idempotencyKey).toBe(`pay_${checkoutId}`);
  });
});
