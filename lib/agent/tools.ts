/**
 * Agent tools — 7 tools for the full Browse → Buy → Pay lifecycle.
 *
 * Merchant tools call repositories directly (same process, no HTTP).
 * Nekuda tools call @nekuda/nekuda-js for staged authorization.
 *
 * SECURITY (AI Isolation per Nekuda best practices):
 * - Raw card data (PAN, CVV, expiry) is NEVER stored or returned to the LLM.
 * - requestCardRevealToken reveals card details into ephemeral local variables,
 *   immediately tokenizes them via Stripe (POST /v1/tokens → PaymentMethod),
 *   and stores only the pm_xxx ID in a lightweight paymentMethodVault.
 * - executePayment reads the pre-created PM ID — no raw card data anywhere.
 * - The LLM only sees { success: true, last4: "XXXX" } after reveal.
 *
 * Every tool returns a result string/object (never throws), so the LLM
 * can reason about errors and recover gracefully.
 */

import { z } from "zod";
import { tool } from "ai";
import { productRepo } from "@/lib/merchant/product-repo";
import { cartRepo } from "@/lib/merchant/cart-repo";
import { nekuda } from "@/lib/nekuda";
import { stripe, createTokenizedPaymentMethod } from "@/lib/stripe";
import {
  MandateData,
  NekudaApiError,
  NekudaConnectionError,
  NekudaValidationError,
  AuthenticationError,
  CardNotFoundError,
} from "@nekuda/nekuda-js";
import {
  updateSession,
  getSession,
  storePaymentMethodId,
  getPaymentMethodId,
  clearPaymentMethodId,
} from "@/lib/agent/session-store";
import { createLogger, redactEmail } from "@/lib/logger";

const log = createLogger("AGENT");

/** Safety margin before 60-min CVV TTL (55 min) */
const CREDENTIAL_TTL_MS = 55 * 60 * 1000;

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
        const cart = cartRepo.create(userId);
        updateSession(sessionId, {
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
        const result = cartRepo.addItem(cartId, productId, quantity);
        if ("error" in result) {
          log.warn("addToCart failed", { error: result.error, cartId, productId });
          return { error: result.error };
        }
        updateSession(sessionId, {
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
        const result = cartRepo.removeItem(cartId, productId);
        if ("error" in result) return { error: result.error };
        updateSession(sessionId, { cartTotal: result.total });
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
        const result = cartRepo.checkout(cartId);
        if ("error" in result) {
          log.warn("checkoutCart failed", { error: result.error, cartId });
          return { error: result.error };
        }
        updateSession(sessionId, {
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
        const cart = cartRepo.get(checkoutId);
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
          updateSession(sessionId, {
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
            updateSession(sessionId, { mandateStatus: "failed", error: "No payment method configured" });
            return {
              error: "NO_PAYMENT_METHOD",
              message: "No payment method is set up yet. Please visit the Wallet page to add a card before making a purchase.",
              retryable: false,
            };
          }
          return handleNekudaError(err, "createMandate", sessionId);
        }
      },
    }),

    requestCardRevealToken: tool({
      description:
        "Step 2 of payment: Request a reveal token, reveal card details, and tokenize them into a Stripe PaymentMethod. Raw card data is never stored — only the tokenized PM ID is kept server-side. You will only see the last 4 digits. Requires a mandateId from createMandate.",
      inputSchema: z.object({
        mandateId: z
          .union([z.string(), z.number()])
          .describe("Mandate ID from createMandate"),
      }),
      execute: async ({ mandateId }) => {
        // Step 2a: Get reveal token (Nekuda API)
        let tokenResult;
        try {
          const user = nekuda.user(userId);
          tokenResult = await user.requestCardRevealToken(String(mandateId));
          updateSession(sessionId, { revealTokenObtained: true });
          log.info("Reveal token obtained", { mandateId, userId: redactEmail(userId) });
        } catch (err) {
          return handleNekudaError(err, "requestCardRevealToken", sessionId);
        }

        // Step 2b: Reveal card details (Nekuda API — CVV expired can occur here)
        let card;
        try {
          const user = nekuda.user(userId);
          card = await user.revealCardDetails(tokenResult.revealToken);
        } catch (err) {
          if (err instanceof NekudaApiError && isCvvExpiredError(err)) {
            log.warn("CVV expired during reveal", { userId: redactEmail(userId) });
            updateSession(sessionId, { credentialsRevealed: false, credentialsRevealedAt: null });
            return {
              error: "CVV_EXPIRED",
              action: "collect_cvv",
              message:
                "Card CVV has expired. User must re-enter CVV on the wallet page before retrying.",
            };
          }
          return handleNekudaError(err, "revealCardDetails", sessionId);
        }

        // Step 2c: Tokenize via Stripe publishable key (Stripe API)
        try {
          if (!card.cardNumber || !card.cardExpiryDate || !card.cardCvv) {
            const missing = [
              !card.cardNumber && "cardNumber",
              !card.cardExpiryDate && "cardExpiryDate",
              !card.cardCvv && "cardCvv",
            ].filter(Boolean).join(", ");
            log.error("Incomplete card data from Nekuda reveal", { missing, userId: redactEmail(userId) });
            updateSession(sessionId, { error: "Incomplete card data received" });
            return { error: "INCOMPLETE_CARD_DATA", message: `Missing: ${missing}`, retryable: true };
          }

          const [expMonth, expYear] = card.cardExpiryDate.split("/").map(Number);
          if (!expMonth || !expYear) {
            log.error("Invalid card expiry format", { userId: redactEmail(userId) });
            updateSession(sessionId, { error: "Invalid card expiry format" });
            return { error: "INVALID_EXPIRY", message: "Card expiry format unrecognized", retryable: true };
          }

          const paymentMethod = await createTokenizedPaymentMethod({
            number: card.cardNumber,
            expMonth,
            expYear: 2000 + expYear,
            cvc: card.cardCvv,
          });

          storePaymentMethodId(sessionId, paymentMethod.id);

          const now = new Date().toISOString();
          updateSession(sessionId, {
            credentialsRevealed: true,
            credentialsRevealedAt: now,
          });

          log.info("Card revealed, tokenized, and PM stored", {
            userId: redactEmail(userId),
            last4: card.last4Digits ?? "N/A",
            paymentMethodId: paymentMethod.id,
          });

          return {
            success: true,
            last4: card.last4Digits ?? null,
            message: "Card tokenized and secured. Ready for payment.",
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : "Card tokenization failed";
          log.error("Stripe tokenization failed", { error: message, userId: redactEmail(userId) });
          updateSession(sessionId, { error: message });
          return { error: "TOKENIZATION_FAILED", message, retryable: true };
        }
      },
    }),

    // ------------------------------------------------------------------
    // Settlement
    // ------------------------------------------------------------------

    executePayment: tool({
      description:
        "Final step: Process payment via Stripe using the pre-tokenized PaymentMethod ID from the server-side vault. No card details needed — only provide the checkoutId.",
      inputSchema: z.object({
        checkoutId: z.string().describe("Checkout ID from checkoutCart"),
      }),
      execute: async ({ checkoutId }) => {
        // 1. Check credential TTL
        const session = getSession(sessionId);
        if (session?.credentialsRevealedAt) {
          const elapsed = Date.now() - new Date(session.credentialsRevealedAt).getTime();
          if (elapsed > CREDENTIAL_TTL_MS) {
            log.warn("Credential TTL exceeded", { sessionId, elapsedMin: Math.round(elapsed / 60000) });
            clearPaymentMethodId(sessionId);
            return {
              error: "CREDENTIALS_EXPIRED",
              message: "Credentials expired (CVV TTL exceeded). Call requestCardRevealToken again before retrying.",
            };
          }
        }

        // 2. Read PaymentMethod ID from vault (raw card data was never stored)
        const paymentMethodId = getPaymentMethodId(sessionId);
        if (!paymentMethodId) {
          return { error: "No payment method found. Call requestCardRevealToken first." };
        }

        // 3. Look up cart + price integrity
        const cart = cartRepo.get(checkoutId);
        if (!cart) return { error: "Checkout not found" };
        if (cart.status !== "checked_out") return { error: `Cart status is '${cart.status}', expected 'checked_out'` };

        let serverTotal = 0;
        for (const item of cart.items) {
          const product = productRepo.getById(item.productId);
          if (!product) return { error: `Product ${item.productId} no longer exists` };
          serverTotal += product.price * item.quantity;
        }
        serverTotal = Math.round(serverTotal * 100) / 100;

        try {
          // 4. Create + confirm PaymentIntent with the pre-tokenized PM
          const paymentIntent = await stripe.paymentIntents.create(
            {
              amount: Math.round(serverTotal * 100),
              currency: "usd",
              payment_method: paymentMethodId,
              confirm: true,
              automatic_payment_methods: { enabled: true, allow_redirects: "never" },
              metadata: { checkoutId, cartId: cart.id, userId: redactEmail(userId) },
            },
            { idempotencyKey: `pay_${checkoutId}` }
          );

          // 5. Mark cart as paid + clear PM from vault
          cartRepo.markPaid(checkoutId);
          clearPaymentMethodId(sessionId);

          updateSession(sessionId, {
            orderId: cart.id,
            stripePaymentIntentId: paymentIntent.id,
            paymentStatus: "succeeded",
          });

          log.info("Payment succeeded", {
            paymentIntentId: paymentIntent.id,
            amount: serverTotal,
            userId: redactEmail(userId),
          });

          return {
            orderId: cart.id,
            stripePaymentIntentId: paymentIntent.id,
            amount: `$${serverTotal.toFixed(2)}`,
            status: paymentIntent.status,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : "Payment failed";
          log.error("Stripe payment failed", { error: message, checkoutId });
          updateSession(sessionId, { paymentStatus: "failed", error: message });
          return { error: message };
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

function handleNekudaError(
  err: unknown,
  toolName: string,
  sessionId: string
): { error: string; retryable: boolean } {
  if (err instanceof CardNotFoundError) {
    log.error(`${toolName} card not found`, {
      code: err.code,
      status: err.statusCode,
      userId: err.userId,
    });
    updateSession(sessionId, { error: "Card not found" });
    return { error: "Card not found. Please add a payment method on the Wallet page.", retryable: false };
  }

  if (err instanceof AuthenticationError) {
    log.error(`${toolName} Nekuda auth failed`, {
      code: err.code,
      status: err.statusCode,
    });
    updateSession(sessionId, { error: "Payment service authentication failed" });
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
    updateSession(sessionId, { error: err.message });
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
      updateSession(sessionId, { error: err.message });
    }
    return { error: err.message, retryable };
  }

  const message = err instanceof Error ? err.message : "Unknown error";
  log.error(`${toolName} unexpected error`, { error: message });
  updateSession(sessionId, { error: message });
  return { error: message, retryable: false };
}
