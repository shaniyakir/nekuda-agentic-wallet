/**
 * POST /api/merchant/cart/:id/checkout
 *
 * Freeze the cart for payment. Only the cart owner can checkout.
 * Refreshes prices from the product repository (Price Integrity)
 * and transitions status to "checked_out".
 */

import { NextRequest, NextResponse } from "next/server";
import { cartRepo } from "@/lib/merchant/cart-repo";
import { getSession } from "@/lib/auth";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: cartId } = await params;

  const cart = await cartRepo.get(cartId);
  if (!cart) {
    return NextResponse.json({ error: "Cart not found" }, { status: 404 });
  }
  if (cart.userId !== session.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await cartRepo.checkout(cartId);

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result);
}
