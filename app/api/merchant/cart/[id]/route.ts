/**
 * GET /api/merchant/cart/:id
 *
 * Retrieve cart details by ID.
 */

import { NextRequest, NextResponse } from "next/server";
import { cartRepo } from "@/lib/merchant/cart-repo";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const cart = cartRepo.get(id);

  if (!cart) {
    return NextResponse.json({ error: "Cart not found" }, { status: 404 });
  }

  return NextResponse.json(cart);
}
