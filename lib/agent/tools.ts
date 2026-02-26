/**
 * Agent tools — 6 tools for the full Browse → Buy → Pay lifecycle.
 *
 * Merchant tools call repositories directly (same process, no HTTP).
 * Nekuda tools call @nekuda/nekuda-js for staged authorization.
 *
 * SECURITY (PCI-compliant browser-use architecture):
 * - Card credentials are NEVER sent over HTTP from this server.
 * - completeCheckout reveals card details via Nekuda, then types them
 *   directly into a Stripe Elements iframe via headless browser automation.
 * - Stripe tokenizes client-side (iframe → Stripe servers) — SAQ-A scope.
 * - The LLM only sees { success, orderId, last4 } — never raw card data.
 *
 * Every tool returns a result string/object (never throws), so the LLM
 * can reason about errors and recover gracefully.
 */

import { z } from "zod";
import { tool } from "ai";
import { productRepo } from "@/lib/merchant/product-repo";
import { cartRepo } from "@/lib/merchant/cart-repo";
import { nekuda } from "@/lib/nekuda";
import {
  MandateData,
  NekudaApiError,
  NekudaConnectionError,
  NekudaValidationError,
  AuthenticationError,
  CardNotFoundError,
} from "@nekuda/nekuda-js";
import { updateSession } from "@/lib/agent/session-store";
import { createLogger, redactEmail } from "@/lib/logger";
import {
  extractCardCredentials,
  completeCheckoutViasBrowser,
  closeBrowser,
} from "@/lib/agent/browser";
import { generateCheckoutToken } from "@/lib/agent/checkout-token";

const log = createLogger("AGENT");

// ---------------------------------------------------------------------------
// Helper: extract sessionId + userId from tool options
// ---------------------------------------------------------------------------

type ToolMeta = { sessionId: string; userId: string };

// ---------------------------------------------------------------------------
// 1. browseProducts
// ---------------------------------------------------------------------------

export const browseProducts = tool({
  description:
    "List all available products in the store. Returns name, price, stock, and ID for each product.",
  inputSchema: z.object({}),
  execute: async () => {
    const products = productRepo.listAll();
    log.info("browseProducts called", { count: products.length });
    return products.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      price: `$${p.price.toFixed(2)}`,
      stock: p.stock,
    }));
  },
});

// ---------------------------------------------------------------------------
// Tool factory — creates tools with session context injected
// ---------------------------------------------------------------------------

export function createToolSet(meta: ToolMeta) {
  const { sessionId, userId } = meta;

  return {
    browseProducts,

    createCart: tool({
      description:
        "Create a new shopping cart for the current user. Must be called before adding items.",
      inputSchema: z.object({}),
      execute: async () => {
        const cart = await cartRepo.create(userId);
        await updateSession(sessionId, {
          cartId: cart.id,
          cartStatus: "active",
          cartTotal: 0,
        });
        log.info("Cart created", { cartId: cart.id, userId: redactEmail(userId) });
        return { cartId: cart.id, status: cart.status };
      },
    }),

    addToCart: tool({
      description:
        "Add a product to the cart by product ID. Specify quantity (default 1).",
      inputSchema: z.object({
        cartId: z.string().describe("The cart ID returned from createCart"),
        productId: z.string().describe("Product ID from browseProducts"),
        quantity: z.number().int().positive().default(1),
      }),
      execute: async ({ cartId, productId, quantity }) => {
        const result = await cartRepo.addItem(cartId, productId, quantity);
        if ("error" in result) {
          log.warn("addToCart failed", { error: result.error, cartId, productId });
          return { error: result.error };
        }
        await updateSession(sessionId, {
          cartStatus: "active",
          cartTotal: result.total,
        });
        log.info("Item added to cart", { cartId, productId, quantity, total: result.total });
        return {
          cartId: result.id,
          items: result.items,
          total: `$${result.total.toFixed(2)}`,
        };
      },
    }),

    removeFromCart: tool({
      description: "Remove a product from the cart entirely.",
      inputSchema: z.object({
        cartId: z.string(),
        productId: z.string(),
      }),
      execute: async ({ cartId, productId }) => {
        const result = await cartRepo.removeItem(cartId, productId);
        if ("error" in result) return { error: result.error };
        await updateSession(sessionId, { cartTotal: result.total });
        log.info("Item removed from cart", { cartId, productId });
        return { cartId: result.id, items: result.items, total: `$${result.total.toFixed(2)}` };
      },
    }),

    checkoutCart: tool({
      description:
        "Freeze the cart for checkout. Recalculates total from source-of-truth prices. Returns the checkoutId needed for payment.",
      inputSchema: z.object({
        cartId: z.string().describe("Cart ID to checkout"),
      }),
      execute: async ({ cartId }) => {
        const result = await cartRepo.checkout(cartId);
        if ("error" in result) {
          log.warn("checkoutCart failed", { error: result.error, cartId });
          return { error: result.error };
        }
        await updateSession(sessionId, {
          checkoutId: result.id,
          cartStatus: "checked_out",
          cartTotal: result.total,
        });
        log.info("Cart checked out", { checkoutId: result.id, total: result.total });
        return {
          checkoutId: result.id,
          total: `$${result.total.toFixed(2)}`,
          items: result.items,
          status: "checked_out",
        };
      },
    }),

    // ------------------------------------------------------------------
    // Nekuda Staged Authorization (3 steps)
    // ------------------------------------------------------------------

    createMandate: tool({
      description:
        "Step 1 of payment: Create a purchase mandate with Nekuda using the server-verified cart total. Requires a checkoutId from checkoutCart. This requests spending approval from the user's wallet for the exact amount that will be charged.",
      inputSchema: z.object({
        checkoutId: z.string().describe("Checkout ID from checkoutCart"),
      }),
      execute: async ({ checkoutId }) => {
        const cart = await cartRepo.get(checkoutId);
        if (!cart) return { error: "Checkout not found. Call checkoutCart first." };
        if (cart.status !== "checked_out") return { error: `Cart status is '${cart.status}', expected 'checked_out'` };

        let serverTotal = 0;
        const productNames: string[] = [];
        for (const item of cart.items) {
          const product = productRepo.getById(item.productId);
          if (!product) return { error: `Product ${item.productId} no longer exists` };
          serverTotal += product.price * item.quantity;
          productNames.push(`${item.quantity}x ${product.name}`);
        }
        serverTotal = Math.round(serverTotal * 100) / 100;

        try {
          const user = nekuda.user(userId);
          const mandateData = new MandateData({
            product: productNames.join(", "),
            price: serverTotal,
            currency: "USD",
            merchant: "ByteShop",
            mode: "sandbox",
          });
          const result = await user.createMandate(mandateData);
          await updateSession(sessionId, {
            mandateId: result.mandateId,
            mandateStatus: "approved",
          });
          log.info("Mandate created", { mandateId: result.mandateId, userId: redactEmail(userId), price: serverTotal });
          return {
            mandateId: result.mandateId,
            status: "approved",
            amount: `$${serverTotal.toFixed(2)}`,
            requestId: result.requestId,
          };
        } catch (err) {
          if (isNoPaymentMethodError(err)) {
            log.warn("No payment method configured", { userId: redactEmail(userId) });
            await updateSession(sessionId, { mandateStatus: "failed", error: "No payment method configured" });
            return {
              error: "NO_PAYMENT_METHOD",
              message: "No payment method is set up yet. Please visit the Wallet page to add a card before making a purchase.",
              retryable: false,
            };
          }
          return await handleNekudaError(err, "createMandate", sessionId);
        }
      },
    }),

    // ------------------------------------------------------------------
    // Browser-use checkout (replaces requestCardRevealToken + executePayment)
    // ------------------------------------------------------------------

    completeCheckout: tool({
      description:
        "Step 2 of payment: Complete the checkout using browser automation. Reveals card credentials via Nekuda, fills billing and card details into the checkout page's Stripe Elements iframe via headless browser, and submits payment. Card data never passes through HTTP — it flows directly browser → Stripe iframe → Stripe servers. Requires a mandateId from createMandate and a checkoutId from checkoutCart.",
      inputSchema: z.object({
        checkoutId: z.string().describe("Checkout ID from checkoutCart"),
        mandateId: z
          .union([z.string(), z.number()])
          .describe("Mandate ID from createMandate"),
      }),
      execute: async ({ checkoutId, mandateId }) => {
        const user = nekuda.user(userId);

        // 1. Request reveal token
        let revealToken: string;
        try {
          const tokenResult = await user.requestCardRevealToken(String(mandateId));
          revealToken = tokenResult.revealToken;
          await updateSession(sessionId, { browserCheckoutStatus: "reveal_token_obtained" });
          log.info("Reveal token obtained", { mandateId, userId: redactEmail(userId) });
        } catch (err) {
          return await handleNekudaError(err, "requestCardRevealToken", sessionId);
        }

        // 2. Reveal card details (DPAN for Visa-tokenized cards)
        let cardCredentials;
        try {
          const card = await user.revealCardDetails(revealToken);
          const extracted = extractCardCredentials(card);
          if ("error" in extracted) {
            log.error("Incomplete card data from Nekuda", { error: extracted.error, userId: redactEmail(userId) });
            await updateSession(sessionId, { error: extracted.error });
            return { error: "INCOMPLETE_CARD_DATA", message: extracted.error, retryable: true };
          }
          cardCredentials = { credentials: extracted, last4: card.last4Digits ?? "N/A" };
          await updateSession(sessionId, { browserCheckoutStatus: "card_revealed" });
          log.info("Card credentials revealed", { last4: cardCredentials.last4, userId: redactEmail(userId) });
        } catch (err) {
          if (err instanceof NekudaApiError && isCvvExpiredError(err)) {
            log.warn("CVV expired during reveal", { userId: redactEmail(userId) });
            await updateSession(sessionId, { browserCheckoutStatus: "cvv_expired" });
            return {
              error: "CVV_EXPIRED",
              action: "collect_cvv",
              message: "Card CVV has expired. User must re-enter CVV on the wallet page before retrying.",
            };
          }
          return await handleNekudaError(err, "revealCardDetails", sessionId);
        }

        // 3. Get billing details
        let billing;
        try {
          billing = await user.getBillingDetails();
          await updateSession(sessionId, { browserCheckoutStatus: "billing_obtained" });
          log.info("Billing details obtained", { userId: redactEmail(userId) });
        } catch (err) {
          return await handleNekudaError(err, "getBillingDetails", sessionId);
        }

        // 4. Run browser automation: navigate, fill, submit
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
        try {
          await updateSession(sessionId, { browserCheckoutStatus: "browser_filling" });

          const checkoutToken = generateCheckoutToken(checkoutId);
          const result = await completeCheckoutViasBrowser({
            checkoutId,
            billing,
            email: userId,
            card: cardCredentials.credentials,
            baseUrl,
            checkoutToken,
          });

          if (!result.success) {
            log.error("Browser checkout failed", { error: result.error, checkoutId });
            await updateSession(sessionId, {
              browserCheckoutStatus: "failed",
              paymentStatus: "failed",
              error: result.error ?? "Browser checkout failed",
            });
            const isExpired = result.error?.includes("CHECKOUT_SESSION_EXPIRED");
            return {
              error: result.error ?? "Payment failed during browser checkout",
              retryable: !isExpired,
            };
          }

          await updateSession(sessionId, {
            browserCheckoutStatus: "completed",
            orderId: result.orderId ?? checkoutId,
            stripePaymentIntentId: result.stripePaymentIntentId ?? null,
            paymentStatus: "succeeded",
          });

          log.info("Browser checkout succeeded", {
            orderId: result.orderId,
            amount: result.amount,
            userId: redactEmail(userId),
          });

          return {
            success: true,
            orderId: result.orderId ?? checkoutId,
            stripePaymentIntentId: result.stripePaymentIntentId,
            amount: result.amount,
            last4: cardCredentials.last4,
            status: "succeeded",
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : "Browser checkout failed";
          log.error("Browser automation error", { error: message, checkoutId });
          await updateSession(sessionId, {
            browserCheckoutStatus: "failed",
            paymentStatus: "failed",
            error: message,
          });
          return { error: message, retryable: true };
        } finally {
          await closeBrowser();
        }
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

/**
 * Detect "no payment method configured" errors.
 * Uses CardNotFoundError from the SDK hierarchy when available (per Nekuda docs),
 * with a fallback for cases where the SDK wraps the error generically.
 */
function isNoPaymentMethodError(err: unknown): boolean {
  if (err instanceof CardNotFoundError) return true;
  if (!(err instanceof NekudaApiError)) return false;
  if (err.statusCode !== 400) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("no payment method") || msg.includes("no card") ||
    msg.includes("unknown error");
}

function isCvvExpiredError(err: NekudaApiError): boolean {
  const msg = err.message.toLowerCase();
  return (
    msg.includes("cvv") && (msg.includes("expired") || msg.includes("invalid"))
  );
}

async function handleNekudaError(
  err: unknown,
  toolName: string,
  sessionId: string
): Promise<{ error: string; retryable: boolean }> {
  if (err instanceof CardNotFoundError) {
    log.error(`${toolName} card not found`, {
      code: err.code,
      status: err.statusCode,
      userId: err.userId,
    });
    await updateSession(sessionId, { error: "Card not found" });
    return { error: "Card not found. Please add a payment method on the Wallet page.", retryable: false };
  }

  if (err instanceof AuthenticationError) {
    log.error(`${toolName} Nekuda auth failed`, {
      code: err.code,
      status: err.statusCode,
    });
    await updateSession(sessionId, { error: "Payment service authentication failed" });
    return {
      error: "Payment service configuration error. Please contact support.",
      retryable: false,
    };
  }

  if (err instanceof NekudaConnectionError) {
    log.warn(`${toolName} Nekuda connection error`, {
      message: err.message,
    });
    return {
      error: "Could not reach the payment service. Please try again in a moment.",
      retryable: true,
    };
  }

  if (err instanceof NekudaValidationError) {
    log.error(`${toolName} Nekuda validation error (possible SDK/API mismatch)`, {
      message: err.message,
    });
    await updateSession(sessionId, { error: err.message });
    return { error: err.message, retryable: false };
  }

  if (err instanceof NekudaApiError) {
    const retryable = [429, 503].includes(err.statusCode);
    log.error(`${toolName} Nekuda API error`, {
      code: err.code,
      status: err.statusCode,
      message: err.message,
    });
    if (!retryable) {
      await updateSession(sessionId, { error: err.message });
    }
    return { error: err.message, retryable };
  }

  const message = err instanceof Error ? err.message : "Unknown error";
  log.error(`${toolName} unexpected error`, { error: message });
  await updateSession(sessionId, { error: message });
  return { error: message, retryable: false };
}
