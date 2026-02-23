/**
 * POST /api/merchant/cart
 *
 * Create a new shopping cart for the authenticated user.
 */

import { NextRequest, NextResponse } from "next/server";
import { cartRepo } from "@/lib/merchant/cart-repo";
import { getSession } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Ignore body userId — use authenticated identity
  const cart = cartRepo.create(session.userId);
  return NextResponse.json(cart, { status: 201 });
}
