/**
 * Checkout session tokens — HMAC-signed, stateless (serverless-safe).
 *
 * Secures the unauthenticated /api/checkout/[checkoutId] and
 * /api/checkout/[checkoutId]/pay endpoints. Playwright receives the token
 * as an httpOnly cookie before navigating; the checkout page's fetch calls
 * carry it automatically.
 *
 * Format: base64url(checkoutId) + "." + expiresAt_hex + "." + hmac_hex
 *
 * Works across Vercel serverless instances — stateless verification via
 * SESSION_SECRET, no shared state (Redis/Map) required.
 * TTL: 5 minutes (sufficient for any checkout flow).
 */

import { createHmac, timingSafeEqual } from "crypto";
import { createLogger } from "@/lib/logger";

const log = createLogger("CHECKOUT");

/** Cookie name sent by Playwright and read by checkout API routes */
export const CHECKOUT_TOKEN_COOKIE = "checkout-token";

/** TTL for checkout session tokens (5 minutes) */
const CHECKOUT_TOKEN_TTL_MS = 5 * 60 * 1000;

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET env var is required for checkout token signing");
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("hex");
}

/**
 * Generate a stateless HMAC-signed checkout session token.
 *
 * Format: base64url(checkoutId) + "." + expiresAt_hex + "." + hmac_hex
 *
 * Binds the token to a specific checkoutId so it cannot be reused for a
 * different checkout, even if intercepted.
 */
export function generateCheckoutToken(checkoutId: string): string {
  const idB64 = Buffer.from(checkoutId).toString("base64url");
  const expiresAt = Date.now() + CHECKOUT_TOKEN_TTL_MS;
  const expHex = expiresAt.toString(16);
  const payload = `${idB64}.${expHex}`;
  const sig = sign(payload);

  log.info("Checkout token generated", { checkoutId });
  return `${payload}.${sig}`;
}

/**
 * Verify an HMAC-signed checkout session token.
 *
 * Returns the checkoutId if the token is valid and not expired,
 * or null if the signature is invalid, expired, or malformed.
 * Also verifies the token is bound to the expected checkoutId.
 */
export function verifyCheckoutToken(
  token: string,
  expectedCheckoutId: string
): boolean {
  if (!token) return false;

  const parts = token.split(".");
  if (parts.length !== 3) {
    log.warn("Checkout token malformed");
    return false;
  }

  const [idB64, expHex, providedSig] = parts;
  const payload = `${idB64}.${expHex}`;
  const expectedSig = sign(payload);

  // Constant-time comparison to prevent timing attacks
  try {
    const a = Buffer.from(providedSig, "hex");
    const b = Buffer.from(expectedSig, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      log.warn("Checkout token signature invalid");
      return false;
    }
  } catch {
    log.warn("Checkout token signature comparison failed");
    return false;
  }

  const expiresAt = parseInt(expHex, 16);
  if (Date.now() > expiresAt) {
    log.warn("Checkout token expired", { checkoutId: expectedCheckoutId });
    return false;
  }

  const checkoutId = Buffer.from(idB64, "base64url").toString("utf-8");
  if (checkoutId !== expectedCheckoutId) {
    log.warn("Checkout token checkoutId mismatch");
    return false;
  }

  return true;
}
