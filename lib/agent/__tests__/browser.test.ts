import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CardDetailsResponse } from "@nekuda/nekuda-js";

// ---------------------------------------------------------------------------
// Mock Playwright — vi.mock is hoisted, so use vi.hoisted() for any variables
// referenced inside the factory (otherwise they're in the TDZ at hoist time).
// ---------------------------------------------------------------------------

const mockAddCookies = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

const mockFill = vi.fn();
const mockClick = vi.fn();
const mockIsVisible = vi.fn().mockResolvedValue(false);
const mockTextContent = vi.fn();
const mockGoto = vi.fn();

const mockLocator = vi.fn().mockReturnValue({
  fill: mockFill,
  click: mockClick,
  isVisible: mockIsVisible,
  textContent: mockTextContent,
  waitFor: vi.fn(),
});

const mockFrameLocatorLocator = vi.fn().mockReturnValue({
  fill: mockFill,
});

const mockFrameLocator = vi.fn().mockReturnValue({
  locator: mockFrameLocatorLocator,
});

const mockPage = {
  goto: mockGoto,
  locator: mockLocator,
  frameLocator: mockFrameLocator,
} as any;

vi.mock("playwright", () => {
  const browser = {
    isConnected: () => true,
    newContext: vi.fn().mockResolvedValue({
      addCookies: mockAddCookies,
      newPage: vi.fn().mockResolvedValue({}),
      close: vi.fn(),
    }),
    close: vi.fn(),
  };
  return {
    chromium: {
      launch: vi.fn().mockResolvedValue(browser),
    },
  };
});

// Import after mock setup
import {
  extractCardCredentials,
  fillBillingDetails,
  fillEmail,
  fillStripeCard,
  navigateToCheckout,
  submitAndWaitForResult,
  getBrowser,
  closeBrowser,
  completeCheckoutViasBrowser,
} from "@/lib/agent/browser";

// ---------------------------------------------------------------------------
// extractCardCredentials (pure function — no mocks needed)
// ---------------------------------------------------------------------------

describe("extractCardCredentials", () => {
  it("extracts VGS card details (standard flow)", () => {
    const card: CardDetailsResponse = {
      cardNumber: "4242424242424242",
      cardExpiryDate: "12/26",
      cardCvv: "123",
      last4Digits: "4242",
    };

    const result = extractCardCredentials(card);
    expect(result).toEqual({
      number: "4242424242424242",
      expiry: "1226",
      cvc: "123",
    });
  });

  it("prefers Visa credentials (DPAN) when available", () => {
    const card: CardDetailsResponse = {
      cardNumber: "4111111111111111",
      cardExpiryDate: "06/27",
      cardCvv: "999",
      isVisaPayment: true,
      visaCredentials: {
        cardNumber: "4000000000003063",
        expiryMonth: "08",
        expiryYear: "28",
        cvv: "456",
      },
    };

    const result = extractCardCredentials(card);
    expect(result).toEqual({
      number: "4000000000003063",
      expiry: "0828",
      cvc: "456",
    });
  });

  it("returns error when card number is missing", () => {
    const card: CardDetailsResponse = {
      cardExpiryDate: "12/26",
      cardCvv: "123",
    };

    const result = extractCardCredentials(card);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("cardNumber");
    }
  });

  it("returns error when expiry is missing", () => {
    const card: CardDetailsResponse = {
      cardNumber: "4242424242424242",
      cardCvv: "123",
    };

    const result = extractCardCredentials(card);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("cardExpiryDate");
    }
  });

  it("returns error when Visa credentials are incomplete", () => {
    const card: CardDetailsResponse = {
      isVisaPayment: true,
      visaCredentials: {
        cardNumber: "",
        expiryMonth: "08",
        expiryYear: "28",
        cvv: "456",
      },
    };

    const result = extractCardCredentials(card);
    expect("error" in result).toBe(true);
  });

  it("handles missing CVV gracefully for VGS cards", () => {
    const card: CardDetailsResponse = {
      cardNumber: "4242424242424242",
      cardExpiryDate: "12/26",
    };

    const result = extractCardCredentials(card);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.cvc).toBe("");
    }
  });
});

// ---------------------------------------------------------------------------
// Browser lifecycle
// ---------------------------------------------------------------------------

describe("getBrowser", () => {
  it("returns a browser instance", async () => {
    const browser = await getBrowser();
    expect(browser).toBeDefined();
  });
});

describe("closeBrowser", () => {
  it("closes without error", async () => {
    await getBrowser();
    await closeBrowser();
  });
});

// ---------------------------------------------------------------------------
// navigateToCheckout
// ---------------------------------------------------------------------------

describe("navigateToCheckout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsVisible.mockResolvedValue(false);
    mockLocator.mockReturnValue({
      fill: mockFill,
      click: mockClick,
      isVisible: mockIsVisible,
      textContent: mockTextContent,
      waitFor: vi.fn(),
    });
  });

  it("navigates to the correct URL", async () => {
    await navigateToCheckout(mockPage, "cart_123", "http://localhost:3000");
    expect(mockGoto).toHaveBeenCalledWith(
      "http://localhost:3000/checkout/cart_123",
      { waitUntil: "networkidle" }
    );
  });

  it("throws when checkout page shows an error", async () => {
    mockLocator.mockReturnValue({
      isVisible: vi.fn().mockResolvedValue(true),
      textContent: vi.fn().mockResolvedValue("Cart not found"),
    });

    await expect(
      navigateToCheckout(mockPage, "bad_id", "http://localhost:3000")
    ).rejects.toThrow("Checkout page error: Cart not found");
  });
});

// ---------------------------------------------------------------------------
// fillBillingDetails
// ---------------------------------------------------------------------------

describe("fillBillingDetails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocator.mockReturnValue({ fill: mockFill });
  });

  it("fills all billing fields", async () => {
    const billing = {
      userId: "user@test.com",
      cardholderName: "Jane Doe",
      phoneNumber: "+15551234567",
      billingAddress: "123 Main St",
      zipCode: "94102",
      city: "San Francisco",
      state: "CA",
    };

    await fillBillingDetails(mockPage, billing);

    expect(mockLocator).toHaveBeenCalledWith('input[name="fullName"]');
    expect(mockLocator).toHaveBeenCalledWith('input[name="phone"]');
    expect(mockLocator).toHaveBeenCalledWith('input[name="address"]');
    expect(mockLocator).toHaveBeenCalledWith('input[name="zip"]');
    expect(mockLocator).toHaveBeenCalledWith('input[name="city"]');
    expect(mockLocator).toHaveBeenCalledWith('input[name="state"]');
    expect(mockFill).toHaveBeenCalledWith("Jane Doe");
    expect(mockFill).toHaveBeenCalledWith("+15551234567");
    expect(mockFill).toHaveBeenCalledWith("123 Main St");
    expect(mockFill).toHaveBeenCalledWith("94102");
    expect(mockFill).toHaveBeenCalledWith("San Francisco");
    expect(mockFill).toHaveBeenCalledWith("CA");
  });

  it("skips optional city and state when not provided", async () => {
    const billing = {
      userId: "user@test.com",
      cardholderName: "Jane Doe",
      phoneNumber: "+15551234567",
      billingAddress: "123 Main St",
      zipCode: "94102",
    };

    await fillBillingDetails(mockPage, billing);

    expect(mockLocator).not.toHaveBeenCalledWith('input[name="city"]');
    expect(mockLocator).not.toHaveBeenCalledWith('input[name="state"]');
  });
});

// ---------------------------------------------------------------------------
// fillEmail
// ---------------------------------------------------------------------------

describe("fillEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocator.mockReturnValue({ fill: mockFill });
  });

  it("fills the email field", async () => {
    await fillEmail(mockPage, "test@example.com");
    expect(mockLocator).toHaveBeenCalledWith('input[name="email"]');
    expect(mockFill).toHaveBeenCalledWith("test@example.com");
  });
});

// ---------------------------------------------------------------------------
// fillStripeCard
// ---------------------------------------------------------------------------

describe("fillStripeCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrameLocatorLocator.mockReturnValue({ fill: mockFill });
  });

  it("targets the Stripe iframe and fills card fields", async () => {
    const card = { number: "4242424242424242", expiry: "1226", cvc: "314" };
    await fillStripeCard(mockPage, card);

    expect(mockFrameLocator).toHaveBeenCalledWith(
      'iframe[title="Secure card payment input frame"]'
    );
    expect(mockFrameLocatorLocator).toHaveBeenCalledWith(
      '[name="cardnumber"]'
    );
    expect(mockFrameLocatorLocator).toHaveBeenCalledWith(
      '[name="exp-date"]'
    );
    expect(mockFrameLocatorLocator).toHaveBeenCalledWith('[name="cvc"]');
    expect(mockFill).toHaveBeenCalledWith("4242424242424242");
    expect(mockFill).toHaveBeenCalledWith("1226");
    expect(mockFill).toHaveBeenCalledWith("314");
  });
});

// ---------------------------------------------------------------------------
// submitAndWaitForResult
// ---------------------------------------------------------------------------

describe("submitAndWaitForResult", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns success when checkout-success element appears", async () => {
    const successLocator = {
      waitFor: vi.fn().mockResolvedValue(undefined),
    };
    const errorLocator = {
      waitFor: vi.fn().mockReturnValue(new Promise(() => {})),
    };

    mockLocator.mockImplementation((selector: string) => {
      if (selector === '[data-testid="checkout-success"]') return successLocator;
      if (selector === '[data-testid="checkout-error"]') return errorLocator;
      if (selector === 'button[type="submit"]') return { click: mockClick };
      return {
        textContent: vi.fn().mockResolvedValue("Order ID: ord_123"),
      };
    });

    const result = await submitAndWaitForResult(mockPage);
    expect(result.success).toBe(true);
    expect(mockClick).toHaveBeenCalled();
  });

  it("returns error when checkout-error element appears", async () => {
    const successLocator = {
      waitFor: vi.fn().mockReturnValue(new Promise(() => {})),
    };
    const errorLocator = {
      waitFor: vi.fn().mockResolvedValue(undefined),
      textContent: vi.fn().mockResolvedValue("Insufficient funds"),
    };

    mockLocator.mockImplementation((selector: string) => {
      if (selector === '[data-testid="checkout-success"]') return successLocator;
      if (selector === '[data-testid="checkout-error"]') return errorLocator;
      if (selector === 'button[type="submit"]') return { click: mockClick };
      return { textContent: vi.fn() };
    });

    const result = await submitAndWaitForResult(mockPage);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Insufficient funds");
  });
});

// ---------------------------------------------------------------------------
// completeCheckoutViasBrowser — cookie injection
// ---------------------------------------------------------------------------

describe("completeCheckoutViasBrowser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAddCookies.mockResolvedValue(undefined);
  });

  it("calls addCookies with the checkout token before navigating", async () => {
    // Make goto + error-check succeed, submit return an error immediately
    mockGoto.mockResolvedValue(undefined);
    mockIsVisible.mockResolvedValue(false);
    mockLocator.mockReturnValue({
      fill: mockFill,
      click: mockClick,
      isVisible: mockIsVisible,
      textContent: mockTextContent,
      waitFor: vi.fn().mockRejectedValue(new Error("timeout")),
    });

    const options = {
      checkoutId: "cart_cookie_test",
      billing: {
        userId: "u@test.com",
        cardholderName: "Test User",
        phoneNumber: "+15550001111",
        billingAddress: "1 Test St",
        zipCode: "00000",
      },
      email: "u@test.com",
      card: { number: "4242424242424242", expiry: "1226", cvc: "314" },
      baseUrl: "http://localhost:3000",
      checkoutToken: "tok.abc.sig",
    };

    // Should not throw — errors are caught and returned as { success: false }
    await completeCheckoutViasBrowser(options);

    expect(mockAddCookies).toHaveBeenCalledOnce();
    const [cookies] = mockAddCookies.mock.calls[0];
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatchObject({
      name: "checkout-token",
      value: "tok.abc.sig",
      domain: "localhost",
      path: "/api/checkout/cart_cookie_test",
      httpOnly: true,
    });
  });
});
