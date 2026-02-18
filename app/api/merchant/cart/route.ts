/**
 * POST /api/merchant/cart
 *
 * Create a new shopping cart for a user.
 * Body: { userId: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { CreateCartRequestSchema } from "@/lib/types";
import { cartRepo } from "@/lib/merchant/cart-repo";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = CreateCartRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const cart = cartRepo.create(parsed.data.userId);
  return NextResponse.json(cart, { status: 201 });
}
