/**
 * GET /api/merchant/cart/:id
 *
 * Retrieve cart details by ID. Only the cart owner can access it.
 */

import { NextRequest, NextResponse } from "next/server";
import { cartRepo } from "@/lib/merchant/cart-repo";
import { getSession } from "@/lib/auth";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const cart = await cartRepo.get(id);

  if (!cart) {
    return NextResponse.json({ error: "Cart not found" }, { status: 404 });
  }

  if (cart.userId !== session.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(cart);
}
