/**
 * POST /api/merchant/cart/:id/add
 *
 * Add a product to an existing cart.
 * Body: { productId: string, quantity?: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { AddToCartRequestSchema } from "@/lib/types";
import { cartRepo } from "@/lib/merchant/cart-repo";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: cartId } = await params;
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
