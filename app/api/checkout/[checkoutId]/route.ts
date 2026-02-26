/**
 * GET /api/checkout/[checkoutId]
 *
 * Load cart data for the checkout page. Protected by a short-lived HMAC-signed
 * checkout token set as an httpOnly cookie by Playwright before navigating.
 * Stateless — no shared state required (Vercel-safe).
 *
 * Only returns carts in "checked_out" status.
 */

import { NextRequest, NextResponse } from "next/server";
import { cartRepo } from "@/lib/merchant/cart-repo";
import {
  verifyCheckoutToken,
  CHECKOUT_TOKEN_COOKIE,
} from "@/lib/agent/checkout-token";

export async function GET(
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

  const cart = await cartRepo.get(checkoutId);

  if (!cart) {
    return NextResponse.json({ error: "Cart not found" }, { status: 404 });
  }

  if (cart.status !== "checked_out") {
    return NextResponse.json(
      { error: `Cart status is "${cart.status}" — must be checked out first` },
      { status: 400 }
    );
  }

  const { userId: _stripped, ...safeCart } = cart;
  return NextResponse.json(safeCart);
}
