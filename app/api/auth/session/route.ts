/**
 * GET /api/auth/session    — Read current session (userId or null)
 * DELETE /api/auth/session  — Destroy session (logout)
 *
 * Note: Session creation is handled by the magic link flow:
 *   POST /api/auth/magic-link → email with link → GET /api/auth/verify?token=x
 */

import { NextResponse } from "next/server";
import { getSession, destroySession } from "@/lib/auth";
import { createLogger } from "@/lib/logger";

const log = createLogger("AUTH");

export async function GET() {
  const session = await getSession();
  return NextResponse.json({ userId: session.userId });
}

export async function DELETE() {
  await destroySession();
  log.info("Session destroyed");
  return NextResponse.json({ userId: null });
}
