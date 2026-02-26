/**
 * POST /api/checkout/[checkoutId]/pay
 *
 * Receives a Stripe PaymentMethod ID (pm_xxx) from the checkout page after
 * Stripe Elements tokenized the card client-side. Creates a PaymentIntent
 * with price integrity validation.
 *
 * This route NEVER receives raw card data — only the Stripe-generated pm_xxx.
 * Card data flows: browser → Stripe Elements iframe → Stripe servers.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { stripe } from "@/lib/stripe";
import { cartRepo } from "@/lib/merchant/cart-repo";
import { productRepo } from "@/lib/merchant/product-repo";
import { createLogger, redactEmail } from "@/lib/logger";
import {
  verifyCheckoutToken,
  CHECKOUT_TOKEN_COOKIE,
} from "@/lib/agent/checkout-token";

const log = createLogger("CHECKOUT");

const PayRequestSchema = z.object({
  paymentMethodId: z
    .string()
    .min(1, "paymentMethodId is required")
    .startsWith("pm_", "Must be a Stripe PaymentMethod ID"),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ checkoutId: string }> }
) {
  const { checkoutId } = await params;

  const token = request.cookies.get(CHECKOUT_TOKEN_COOKIE)?.value ?? "";
  if (!verifyCheckoutToken(token, checkoutId)) {
    return NextResponse.json(
      { error: "CHECKOUT_SESSION_EXPIRED" },
      { status: 401 }
    );
  }

  let body: z.infer<typeof PayRequestSchema>;
  try {
    const raw = await request.json();
    body = PayRequestSchema.parse(raw);
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.issues.map((e: { message: string }) => e.message).join(", ")
        : "Invalid request body";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const cart = cartRepo.get(checkoutId);
  if (!cart) {
    return NextResponse.json({ error: "Checkout not found" }, { status: 404 });
  }
  if (cart.status !== "checked_out") {
    return NextResponse.json(
      { error: `Cart status is "${cart.status}", expected "checked_out"` },
      { status: 400 }
    );
  }

  // Price integrity: re-calculate total from product repo (source of truth)
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
  serverTotal = Math.round(serverTotal * 100) / 100;

  try {
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: Math.round(serverTotal * 100),
        currency: "usd",
        payment_method: body.paymentMethodId,
        confirm: true,
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: "never",
        },
        metadata: {
          checkoutId,
          cartId: cart.id,
          userId: redactEmail(cart.userId),
        },
      },
      { idempotencyKey: `pay_${checkoutId}` }
    );

    cartRepo.markPaid(checkoutId);

    log.info("Checkout payment succeeded", {
      paymentIntentId: paymentIntent.id,
      amount: serverTotal,
      checkoutId,
    });

    return NextResponse.json({
      orderId: cart.id,
      stripePaymentIntentId: paymentIntent.id,
      amount: `$${serverTotal.toFixed(2)}`,
      status: paymentIntent.status,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Payment processing failed";
    log.error("Checkout payment failed", { error: message, checkoutId });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
