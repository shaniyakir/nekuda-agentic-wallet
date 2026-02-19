/**
 * POST /api/merchant/pay
 *
 * Process payment using Nekuda-revealed card credentials via Stripe.
 *
 * CRITICAL: Price Integrity Validation
 * - We NEVER trust the agent-provided price.
 * - We use the checkoutId to look up the cart, recalculate the total
 *   from the ProductRepository (source of truth), and charge that amount.
 * - If the agent-provided mandateAmount diverges from server-calculated
 *   total, we log the price drift for observability but still use
 *   the server-side amount.
 *
 * Body: { checkoutId, credentials: PaymentCredentials, mandateAmount? }
 */

import { NextRequest, NextResponse } from "next/server";
import { PayRequestSchema } from "@/lib/types";
import { cartRepo } from "@/lib/merchant/cart-repo";
import { productRepo } from "@/lib/merchant/product-repo";
import { createLogger } from "@/lib/logger";
import { stripe } from "@/lib/stripe";

const log = createLogger("MERCHANT");

export async function POST(request: NextRequest) {
  // 1. Validate request body
  const body = await request.json();
  const parsed = PayRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { checkoutId, credentials, mandateAmount } = parsed.data;

  // 2. Look up the cart (checkoutId === cartId after checkout)
  const cart = cartRepo.get(checkoutId);
  if (!cart) {
    return NextResponse.json({ error: "Checkout not found" }, { status: 404 });
  }
  if (cart.status !== "checked_out") {
    return NextResponse.json(
      { error: `Cart status is '${cart.status}', expected 'checked_out'` },
      { status: 400 }
    );
  }

  // 3. Price Integrity Validation: recalculate from product repo
  let serverTotal = 0;
  for (const item of cart.items) {
    const product = productRepo.getById(item.productId);
    if (!product) {
      return NextResponse.json(
        { error: `Product ${item.productId} no longer exists` },
        { status: 400 }
      );
    }
    serverTotal += product.price * item.quantity;
  }

  // Round to 2 decimal places to avoid floating point drift
  serverTotal = Math.round(serverTotal * 100) / 100;

  // 4. Price drift logging (observability)
  if (mandateAmount !== undefined) {
    const drift = Math.abs(mandateAmount - serverTotal);
    if (drift > 0.01) {
      log.warn("Price drift detected", {
        mandateAmount,
        serverTotal,
        drift: Number(drift.toFixed(2)),
      });
    }
  }

  // 5. Parse card expiry for Stripe (MM/YY -> { month, year })
  const [expMonth, expYear] = credentials.cardExpiry.split("/").map(Number);
  if (!expMonth || !expYear) {
    return NextResponse.json(
      { error: "Invalid card expiry format, expected MM/YY" },
      { status: 400 }
    );
  }

  try {
    // 6. Create a Stripe PaymentMethod from the revealed card
    const paymentMethod = await stripe.paymentMethods.create({
      type: "card",
      card: {
        number: credentials.cardNumber,
        exp_month: expMonth,
        exp_year: 2000 + expYear, // Convert YY to YYYY
        cvc: credentials.cvv,
      },
    });

    // 7. Create and confirm a PaymentIntent using server-calculated amount
    //    Idempotency key prevents double-charging on network retries.
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: Math.round(serverTotal * 100), // Stripe expects cents
        currency: "usd",
        payment_method: paymentMethod.id,
        confirm: true,
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: "never",
        },
        metadata: {
          checkoutId,
          cartId: cart.id,
          userId: cart.userId,
        },
      },
      { idempotencyKey: `pay_${checkoutId}` }
    );

    // 8. Mark cart as paid + decrement stock
    const markResult = cartRepo.markPaid(checkoutId);
    if ("error" in markResult) {
      log.error("Post-payment stock update failed", { error: markResult.error, checkoutId });
      // Payment went through but stock update failed — log for manual review
    }

    log.info("Settlement successful", {
      paymentIntentId: paymentIntent.id,
      amount: serverTotal,
      userId: cart.userId,
      checkoutId,
    });

    return NextResponse.json({
      orderId: cart.id,
      stripePaymentIntentId: paymentIntent.id,
      amount: serverTotal,
      currency: "usd",
      status: paymentIntent.status,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown payment error";
    log.error("Stripe error", { error: message, checkoutId });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
