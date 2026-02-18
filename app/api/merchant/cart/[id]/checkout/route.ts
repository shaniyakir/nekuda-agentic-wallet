/**
 * POST /api/merchant/cart/:id/checkout
 *
 * Freeze the cart for payment. Refreshes prices from the product repository
 * (Price Integrity) and transitions status to "checked_out".
 */

import { NextRequest, NextResponse } from "next/server";
import { cartRepo } from "@/lib/merchant/cart-repo";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: cartId } = await params;
  const result = cartRepo.checkout(cartId);

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result);
}
