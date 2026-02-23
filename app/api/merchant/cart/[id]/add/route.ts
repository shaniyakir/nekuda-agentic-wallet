/**
 * POST /api/merchant/cart/:id/add
 *
 * Add a product to an existing cart. Only the cart owner can modify it.
 * Body: { productId: string, quantity?: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { AddToCartRequestSchema } from "@/lib/types";
import { cartRepo } from "@/lib/merchant/cart-repo";
import { getSession } from "@/lib/auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: cartId } = await params;

  const cart = cartRepo.get(cartId);
  if (!cart) {
    return NextResponse.json({ error: "Cart not found" }, { status: 404 });
  }
  if (cart.userId !== session.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = AddToCartRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const result = cartRepo.addItem(cartId, parsed.data.productId, parsed.data.quantity);

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result);
}
