import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  NekudaApiError,
  CardNotFoundError,
  AuthenticationError,
  NekudaConnectionError,
  NekudaValidationError,
} from "@nekuda/nekuda-js";

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

const mockCreateTokenizedPaymentMethod = vi.fn();
const mockPaymentIntentsCreate = vi.fn();

vi.mock("@/lib/stripe", () => ({
  stripe: {
    paymentIntents: { create: (...args: unknown[]) => mockPaymentIntentsCreate(...args) },
  },
  createTokenizedPaymentMethod: (...args: unknown[]) => mockCreateTokenizedPaymentMethod(...args),
}));

import { createToolSet } from "@/lib/agent/tools";
import {
  getOrCreateSession,
  getSession,
  deleteSession,
  updateSession,
  storePaymentMethodId,
  getPaymentMethodId,
  clearPaymentMethodId,
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

  it("returns mandateId on success using server-verified cart total", async () => {
    const checkoutId = await setupCheckedOutCart();
    mockCreateMandate.mockResolvedValue({ mandateId: 42, requestId: "req_abc" });

    const result = await exec(tools.createMandate, { checkoutId }, toolOpts);
    expect(result.mandateId).toBe(42);
    expect(result.status).toBe("approved");
    expect(result.amount).toBe("$89.99");
    expect(result.requestId).toBe("req_abc");

    const session = getSession(sid);
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

    const session = getSession(sid);
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

    const session = getSession(sid);
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

    const session = getSession(sid);
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

    const session = getSession(sid);
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
// requestCardRevealToken — now includes immediate tokenization
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

  it("reveals card, tokenizes immediately, stores only PM ID", async () => {
    mockRequestCardRevealToken.mockResolvedValue({ revealToken: "tok_abc" });
    mockRevealCardDetails.mockResolvedValue(MOCK_CARD);
    mockCreateTokenizedPaymentMethod.mockResolvedValue({ id: "pm_reveal_123" });

    const result = await exec(tools.requestCardRevealToken, { mandateId: 42 }, toolOpts);

    expect(result.success).toBe(true);
    expect(result.last4).toBe("1111");
    expect(result).not.toHaveProperty("cardNumber");
    expect(result).not.toHaveProperty("cvv");

    // Only PM ID stored, not raw card data
    const pmId = getPaymentMethodId(sid);
    expect(pmId).toBe("pm_reveal_123");

    const session = getSession(sid);
    expect(session?.credentialsRevealed).toBe(true);
    expect(session?.credentialsRevealedAt).toBeTruthy();
    expect(session?.revealTokenObtained).toBe(true);

    clearPaymentMethodId(sid);
  });

  it("passes correct card details to tokenization helper", async () => {
    mockRequestCardRevealToken.mockResolvedValue({ revealToken: "tok_abc" });
    mockRevealCardDetails.mockResolvedValue(MOCK_CARD);
    mockCreateTokenizedPaymentMethod.mockResolvedValue({ id: "pm_verify" });

    await exec(tools.requestCardRevealToken, { mandateId: 42 }, toolOpts);

    expect(mockCreateTokenizedPaymentMethod).toHaveBeenCalledWith({
      number: "4111111111111111",
      expMonth: 12,
      expYear: 2028,
      cvc: "321",
    });
  });

  it("returns INCOMPLETE_CARD_DATA when card number is missing", async () => {
    mockRequestCardRevealToken.mockResolvedValue({ revealToken: "tok_abc" });
    mockRevealCardDetails.mockResolvedValue({
      ...MOCK_CARD,
      cardNumber: null,
    });

    const result = await exec(tools.requestCardRevealToken, { mandateId: 42 }, toolOpts);
    expect(result.error).toBe("INCOMPLETE_CARD_DATA");
    expect(result.message).toContain("cardNumber");
    expect(result.retryable).toBe(true);
    expect(mockCreateTokenizedPaymentMethod).not.toHaveBeenCalled();
  });

  it("returns INCOMPLETE_CARD_DATA when CVV is missing", async () => {
    mockRequestCardRevealToken.mockResolvedValue({ revealToken: "tok_abc" });
    mockRevealCardDetails.mockResolvedValue({
      ...MOCK_CARD,
      cardCvv: null,
    });

    const result = await exec(tools.requestCardRevealToken, { mandateId: 42 }, toolOpts);
    expect(result.error).toBe("INCOMPLETE_CARD_DATA");
    expect(result.message).toContain("cardCvv");
    expect(mockCreateTokenizedPaymentMethod).not.toHaveBeenCalled();
  });

  it("returns INCOMPLETE_CARD_DATA when expiry is missing", async () => {
    mockRequestCardRevealToken.mockResolvedValue({ revealToken: "tok_abc" });
    mockRevealCardDetails.mockResolvedValue({
      ...MOCK_CARD,
      cardExpiryDate: null,
    });

    const result = await exec(tools.requestCardRevealToken, { mandateId: 42 }, toolOpts);
    expect(result.error).toBe("INCOMPLETE_CARD_DATA");
    expect(result.message).toContain("cardExpiryDate");
    expect(mockCreateTokenizedPaymentMethod).not.toHaveBeenCalled();
  });

  it("returns INVALID_EXPIRY when expiry format is bad", async () => {
    mockRequestCardRevealToken.mockResolvedValue({ revealToken: "tok_abc" });
    mockRevealCardDetails.mockResolvedValue({
      ...MOCK_CARD,
      cardExpiryDate: "invalid",
    });

    const result = await exec(tools.requestCardRevealToken, { mandateId: 42 }, toolOpts);
    expect(result.error).toBe("INVALID_EXPIRY");
    expect(mockCreateTokenizedPaymentMethod).not.toHaveBeenCalled();
  });

  it("returns error when tokenization fails", async () => {
    mockRequestCardRevealToken.mockResolvedValue({ revealToken: "tok_abc" });
    mockRevealCardDetails.mockResolvedValue(MOCK_CARD);
    mockCreateTokenizedPaymentMethod.mockRejectedValue(
      new Error("Card tokenization failed")
    );

    const result = await exec(tools.requestCardRevealToken, { mandateId: 42 }, toolOpts);
    expect(result.error).toBe("TOKENIZATION_FAILED");
    expect(result.message).toContain("Card tokenization failed");
    expect(result.retryable).toBe(true);
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

  it("returns config error on AuthenticationError during reveal", async () => {
    mockRequestCardRevealToken.mockRejectedValue(
      new AuthenticationError("Unauthorized", "authentication_error", 401)
    );

    const result = await exec(tools.requestCardRevealToken, { mandateId: 42 }, toolOpts);
    expect(result.error).toContain("configuration error");
    expect(result.retryable).toBe(false);
  });

  it("returns retryable error on NekudaConnectionError during reveal", async () => {
    mockRequestCardRevealToken.mockRejectedValue(
      new NekudaConnectionError("ETIMEDOUT")
    );

    const result = await exec(tools.requestCardRevealToken, { mandateId: 42 }, toolOpts);
    expect(result.error).toContain("Could not reach the payment service");
    expect(result.retryable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// executePayment — uses pre-tokenized PM ID from vault
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

  it("succeeds end-to-end: uses PM ID from vault, creates PaymentIntent", async () => {
    const checkoutId = await setupCheckedOutCart();
    storePaymentMethodId(sid, "pm_test_123");
    updateSession(sid, { credentialsRevealedAt: new Date().toISOString() });

    mockPaymentIntentsCreate.mockResolvedValue({ id: "pi_test_456", status: "succeeded" });

    const result = await exec(tools.executePayment, { checkoutId }, toolOpts);

    expect(result.orderId).toBe(checkoutId);
    expect(result.stripePaymentIntentId).toBe("pi_test_456");
    expect(result.amount).toBe("$89.99");
    expect(result.status).toBe("succeeded");

    const session = getSession(sid);
    expect(session?.paymentStatus).toBe("succeeded");
    expect(session?.stripePaymentIntentId).toBe("pi_test_456");

    // PM ID cleared after payment
    expect(getPaymentMethodId(sid)).toBeNull();

    // No tokenization call — PM was pre-created during reveal
    expect(mockCreateTokenizedPaymentMethod).not.toHaveBeenCalled();
  });

  it("returns CREDENTIALS_EXPIRED when TTL exceeded (56 min)", async () => {
    const checkoutId = await setupCheckedOutCart();
    storePaymentMethodId(sid, "pm_expired");

    const fiftysixMinAgo = new Date(Date.now() - 56 * 60 * 1000).toISOString();
    updateSession(sid, { credentialsRevealedAt: fiftysixMinAgo });

    const result = await exec(tools.executePayment, { checkoutId }, toolOpts);

    expect(result.error).toBe("CREDENTIALS_EXPIRED");
    expect(result.message).toContain("requestCardRevealToken");
    expect(getPaymentMethodId(sid)).toBeNull();
  });

  it("allows payment within TTL window (54 min)", async () => {
    const checkoutId = await setupCheckedOutCart();
    storePaymentMethodId(sid, "pm_ok");

    const fiftyFourMinAgo = new Date(Date.now() - 54 * 60 * 1000).toISOString();
    updateSession(sid, { credentialsRevealedAt: fiftyFourMinAgo });

    mockPaymentIntentsCreate.mockResolvedValue({ id: "pi_ok", status: "succeeded" });

    const result = await exec(tools.executePayment, { checkoutId }, toolOpts);
    expect(result.status).toBe("succeeded");
  });

  it("returns error when no PM ID in vault", async () => {
    const checkoutId = await setupCheckedOutCart();
    updateSession(sid, { credentialsRevealedAt: new Date().toISOString() });

    const result = await exec(tools.executePayment, { checkoutId }, toolOpts);
    expect(result.error).toContain("No payment method found");
  });

  it("returns error when Stripe declines the card", async () => {
    const checkoutId = await setupCheckedOutCart();
    storePaymentMethodId(sid, "pm_decline");
    updateSession(sid, { credentialsRevealedAt: new Date().toISOString() });

    mockPaymentIntentsCreate.mockRejectedValue(new Error("Your card was declined."));

    const result = await exec(tools.executePayment, { checkoutId }, toolOpts);

    expect(result.error).toBe("Your card was declined.");

    const session = getSession(sid);
    expect(session?.paymentStatus).toBe("failed");
    expect(session?.error).toBe("Your card was declined.");
  });

  it("returns error when Stripe reports insufficient funds", async () => {
    const checkoutId = await setupCheckedOutCart();
    storePaymentMethodId(sid, "pm_insuf");
    updateSession(sid, { credentialsRevealedAt: new Date().toISOString() });

    mockPaymentIntentsCreate.mockRejectedValue(
      new Error("Your card has insufficient funds.")
    );

    const result = await exec(tools.executePayment, { checkoutId }, toolOpts);
    expect(result.error).toBe("Your card has insufficient funds.");
    expect(getSession(sid)?.paymentStatus).toBe("failed");
  });

  it("returns error for cart that is already paid", async () => {
    const checkoutId = await setupCheckedOutCart();
    storePaymentMethodId(sid, "pm_first");
    updateSession(sid, { credentialsRevealedAt: new Date().toISOString() });

    mockPaymentIntentsCreate.mockResolvedValue({ id: "pi_first", status: "succeeded" });
    await exec(tools.executePayment, { checkoutId }, toolOpts);

    // Second attempt
    storePaymentMethodId(sid, "pm_second");
    updateSession(sid, { credentialsRevealedAt: new Date().toISOString() });
    const result = await exec(tools.executePayment, { checkoutId }, toolOpts);

    expect(result.error).toContain("paid");
  });

  it("passes PM ID and correct amount to Stripe PaymentIntent", async () => {
    const checkoutId = await setupCheckedOutCart();
    storePaymentMethodId(sid, "pm_verify");
    updateSession(sid, { credentialsRevealedAt: new Date().toISOString() });

    mockPaymentIntentsCreate.mockResolvedValue({ id: "pi_verify", status: "succeeded" });

    await exec(tools.executePayment, { checkoutId }, toolOpts);

    const [intentArgs, opts] = mockPaymentIntentsCreate.mock.calls[0];
    expect(intentArgs.payment_method).toBe("pm_verify");
    expect(intentArgs.amount).toBe(8999); // $89.99 in cents
    expect(opts.idempotencyKey).toBe(`pay_${checkoutId}`);
  });
});
