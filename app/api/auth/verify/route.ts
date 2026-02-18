/**
 * GET /api/auth/verify?token=<token>
 *
 * Verify a magic link token, set the encrypted session, and redirect
 * to the wallet page. Token is single-use — consumed on verification.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyMagicToken, setSession } from "@/lib/auth";
import { createLogger } from "@/lib/logger";

const log = createLogger("AUTH");

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json(
      { error: "Missing token parameter" },
      { status: 400 }
    );
  }

  const email = verifyMagicToken(token);

  if (!email) {
    log.warn("Magic link verification failed — invalid or expired token");
    // Redirect to wallet page with error indicator
    return NextResponse.redirect(
      new URL("/wallet?auth=expired", request.nextUrl.origin)
    );
  }

  // Set the email as userId in the encrypted session
  await setSession(email);
  log.info("User authenticated via magic link", { userId: email });

  // Redirect to wallet page
  return NextResponse.redirect(
    new URL("/wallet?auth=success", request.nextUrl.origin)
  );
}
