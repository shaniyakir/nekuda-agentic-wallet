/**
 * Browser automation service for PCI-compliant checkout.
 *
 * Uses Playwright to drive a headless Chromium browser through the
 * checkout page. Card credentials are typed directly into Stripe Elements
 * (a Stripe-hosted iframe) — they flow browser → Stripe iframe → Stripe servers.
 * The application server never transmits card data over HTTP.
 */

import { chromium, type Browser, type Page } from "playwright";
import { createLogger } from "@/lib/logger";
import type {
  BillingDetailsResponse,
  CardDetailsResponse,
} from "@nekuda/nekuda-js";

const log = createLogger("CHECKOUT");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CheckoutResult {
  success: boolean;
  orderId?: string;
  stripePaymentIntentId?: string;
  amount?: string;
  status?: string;
  error?: string;
}

export interface CardCredentials {
  number: string;
  expiry: string;
  cvc: string;
}

// ---------------------------------------------------------------------------
// Helpers: extract card credentials from Nekuda response
// ---------------------------------------------------------------------------

/**
 * Normalize CardDetailsResponse into the three fields needed for Stripe Elements.
 * Prefers visaCredentials (DPAN) when available.
 */
export function extractCardCredentials(
  card: CardDetailsResponse
): CardCredentials | { error: string } {
  if (card.isVisaPayment && card.visaCredentials) {
    const vc = card.visaCredentials;
    if (!vc.cardNumber || !vc.expiryMonth || !vc.expiryYear || !vc.cvv) {
      return { error: "Incomplete Visa credentials from Nekuda" };
    }
    return {
      number: vc.cardNumber,
      expiry: `${vc.expiryMonth}${vc.expiryYear}`,
      cvc: vc.cvv,
    };
  }

  if (!card.cardNumber || !card.cardExpiryDate) {
    const missing = [
      !card.cardNumber && "cardNumber",
      !card.cardExpiryDate && "cardExpiryDate",
    ]
      .filter(Boolean)
      .join(", ");
    return { error: `Incomplete card data from Nekuda: missing ${missing}` };
  }

  const expiry = card.cardExpiryDate.replace("/", "");

  return {
    number: card.cardNumber,
    expiry,
    cvc: card.cardCvv ?? "",
  };
}

// ---------------------------------------------------------------------------
// Browser lifecycle
// ---------------------------------------------------------------------------

let browserInstance: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }
  log.info("Launching headless Chromium");
  browserInstance = await chromium.launch({ headless: true });
  return browserInstance;
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
    log.info("Browser closed");
  }
}

// ---------------------------------------------------------------------------
// Checkout flow steps
// ---------------------------------------------------------------------------

export async function navigateToCheckout(
  page: Page,
  checkoutId: string,
  baseUrl: string
): Promise<void> {
  const url = `${baseUrl}/checkout/${checkoutId}`;
  log.info("Navigating to checkout", { url });
  await page.goto(url, { waitUntil: "networkidle" });

  const errorEl = page.locator('[data-testid="checkout-error"]');
  if (await errorEl.isVisible()) {
    const errorText = await errorEl.textContent();
    throw new Error(`Checkout page error: ${errorText}`);
  }
}

export async function fillBillingDetails(
  page: Page,
  billing: BillingDetailsResponse
): Promise<void> {
  log.info("Filling billing details");

  await page.locator('input[name="fullName"]').fill(billing.cardholderName);
  await page.locator('input[name="phone"]').fill(billing.phoneNumber);
  await page.locator('input[name="address"]').fill(billing.billingAddress);
  await page.locator('input[name="zip"]').fill(billing.zipCode);

  if (billing.city) {
    await page.locator('input[name="city"]').fill(billing.city);
  }
  if (billing.state) {
    await page.locator('input[name="state"]').fill(billing.state);
  }
}

/**
 * Fill the email field separately (not part of BillingDetailsResponse).
 */
export async function fillEmail(page: Page, email: string): Promise<void> {
  await page.locator('input[name="email"]').fill(email);
}

/**
 * Type card credentials into the Stripe Elements iframe.
 * Stripe Elements renders inside a cross-origin iframe — Playwright can
 * interact with it via frameLocator.
 */
export async function fillStripeCard(
  page: Page,
  card: CardCredentials
): Promise<void> {
  log.info("Filling card in Stripe Elements iframe");

  const stripeFrame = page.frameLocator(
    'iframe[name^="__privateStripeFrame"]'
  );

  await stripeFrame
    .locator('[name="cardnumber"]')
    .fill(card.number);
  await stripeFrame
    .locator('[name="exp-date"]')
    .fill(card.expiry);
  await stripeFrame
    .locator('[name="cvc"]')
    .fill(card.cvc);
}

export async function submitAndWaitForResult(
  page: Page,
  timeoutMs: number = 30_000
): Promise<CheckoutResult> {
  log.info("Submitting checkout form");

  await page.locator('button[type="submit"]').click();

  const successLocator = page.locator('[data-testid="checkout-success"]');
  const errorLocator = page.locator('[data-testid="checkout-error"]');

  const result = await Promise.race([
    successLocator
      .waitFor({ state: "visible", timeout: timeoutMs })
      .then(() => "success" as const),
    errorLocator
      .waitFor({ state: "visible", timeout: timeoutMs })
      .then(() => "error" as const),
  ]);

  if (result === "error") {
    const errorText = await errorLocator.textContent();
    return { success: false, error: errorText ?? "Payment failed" };
  }

  const orderId = await page
    .locator("text=Order ID:")
    .textContent()
    .then((t) => t?.replace("Order ID: ", "").trim());
  const amount = await page
    .locator("text=Amount:")
    .textContent()
    .then((t) => t?.replace("Amount: ", "").trim());
  const stripePI = await page
    .locator("text=Stripe PI:")
    .textContent()
    .then((t) => t?.replace("Stripe PI: ", "").trim());

  return {
    success: true,
    orderId: orderId ?? undefined,
    amount: amount ?? undefined,
    stripePaymentIntentId: stripePI ?? undefined,
    status: "succeeded",
  };
}

// ---------------------------------------------------------------------------
// Full checkout orchestration
// ---------------------------------------------------------------------------

export interface CompleteCheckoutOptions {
  checkoutId: string;
  billing: BillingDetailsResponse;
  email: string;
  card: CardCredentials;
  baseUrl: string;
}

/**
 * Run the full browser-use checkout flow:
 * navigate → fill billing → fill card in Stripe iframe → submit → parse result.
 */
export async function completeCheckoutViasBrowser(
  options: CompleteCheckoutOptions
): Promise<CheckoutResult> {
  const { checkoutId, billing, email, card, baseUrl } = options;

  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await navigateToCheckout(page, checkoutId, baseUrl);
    await fillBillingDetails(page, billing);
    await fillEmail(page, email);
    await fillStripeCard(page, card);
    return await submitAndWaitForResult(page);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Browser checkout failed";
    log.error("Browser checkout failed", { error: message, checkoutId });
    return { success: false, error: message };
  } finally {
    await context.close();
  }
}
