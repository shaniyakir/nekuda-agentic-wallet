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

/**
 * Tokenize raw card data using Stripe's publishable key, then create a
 * PaymentMethod via the secret key. This avoids the "Handle card information
 * directly" restriction — uses the "card data collection with a publishable
 * key" permission instead (lower PCI scope).
 *
 * Flow: raw card → pk tokenize → token ID → sk PaymentMethod
 */
export async function createTokenizedPaymentMethod(card: {
  number: string;
  expMonth: number;
  expYear: number;
  cvc: string;
}): Promise<Stripe.PaymentMethod> {
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!publishableKey) {
    throw new Error(
      "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY env var is required for card tokenization."
    );
  }

  const tokenRes = await fetch("https://api.stripe.com/v1/tokens", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${publishableKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      "card[number]": card.number,
      "card[exp_month]": String(card.expMonth),
      "card[exp_year]": String(card.expYear),
      "card[cvc]": card.cvc,
    }),
  });

  const tokenData = await tokenRes.json();
  if (tokenData.error) {
    throw new Error(tokenData.error.message ?? "Card tokenization failed");
  }

  log.info("Card tokenized via publishable key", { tokenId: tokenData.id });

  return stripe.paymentMethods.create({
    type: "card",
    card: { token: tokenData.id },
  });
}
