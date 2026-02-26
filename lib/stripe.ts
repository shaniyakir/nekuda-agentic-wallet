/**
 * Stripe singleton client.
 *
 * Initializes once from `STRIPE_SECRET_KEY`, reused across all requests.
 * Server-side only — never expose on the client.
 *
 * Usage:
 *   import { stripe } from '@/lib/stripe';
 *   const paymentIntent = await stripe.paymentIntents.create({ ... });
 */

import Stripe from "stripe";
import { createLogger } from "@/lib/logger";

const log = createLogger("STRIPE");

function createStripeClient(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      "STRIPE_SECRET_KEY env var is required. Get it from https://dashboard.stripe.com/test/apikeys"
    );
  }

  const client = new Stripe(secretKey, {
    apiVersion: "2026-01-28.clover",
    typescript: true,
  });

  log.info("Stripe client initialized", {
    mode: secretKey.startsWith("sk_test_") ? "test" : "live",
  });
  return client;
}

/**
 * Singleton Stripe client instance.
 * Lazy-initialized on first import (module-level, cached by Node.js module system).
 */
export const stripe: Stripe = createStripeClient();
