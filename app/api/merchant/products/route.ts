/**
 * GET /api/merchant/products
 *
 * Returns the full product catalog.
 */

import { NextResponse } from "next/server";
import { productRepo } from "@/lib/merchant/product-repo";

export async function GET() {
  const products = productRepo.listAll();
  return NextResponse.json(products);
}
