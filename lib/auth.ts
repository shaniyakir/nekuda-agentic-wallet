/**
 * Authentication via Magic Link + iron-session.
 *
 * Flow:
 *   1. User enters email → POST /api/auth/magic-link → email sent with token link
 *   2. User clicks link → GET /api/auth/verify?token=x → session set, redirect to /wallet
 *   3. All subsequent requests read userId (email) from encrypted cookie
 *
 *
 * In dev mode (no RESEND_API_KEY), the magic link is logged to the console
 * for easy testing without an email service.
 *
 * Token design: HMAC-SHA256 signed, stateless — works across Vercel serverless
 * instances without shared state. Format: base64url(email).expHex.hmacHex
 * Trade-off: tokens are NOT single-use (acceptable for 10-min demo TTL).
 */

import { createHmac, timingSafeEqual } from "crypto";
import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { createLogger } from "@/lib/logger";

const log = createLogger("AUTH");

// ---------------------------------------------------------------------------
// Session data shape
// ---------------------------------------------------------------------------

export interface SessionData {
  userId: string | null;
}

const defaultSession: SessionData = {
  userId: null,
};

// ---------------------------------------------------------------------------
// Session config
// ---------------------------------------------------------------------------

export const sessionOptions: SessionOptions = {
  password:
    process.env.SESSION_SECRET ??
    (() => {
      throw new Error("SESSION_SECRET env var is required");
    })(),
  cookieName: "nekuda_session",
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24, // 24 hours
  },
};

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

/**
 * Read the current session from the encrypted cookie.
 * Returns default (userId: null) if no session exists.
 */
export async function getSession(): Promise<SessionData> {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(
    cookieStore,
    sessionOptions
  );
  return {
    userId: session.userId ?? defaultSession.userId,
  };
}

/**
 * Write userId to the encrypted session cookie.
 */
export async function setSession(userId: string): Promise<void> {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(
    cookieStore,
    sessionOptions
  );
  session.userId = userId;
  await session.save();
}

/**
 * Destroy the session (clear the cookie).
 */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(
    cookieStore,
    sessionOptions
  );
  session.destroy();
}

// ---------------------------------------------------------------------------
// Magic Link Token — HMAC-signed stateless (serverless-safe)
// ---------------------------------------------------------------------------

/** TTL for magic link tokens (10 minutes) */
const TOKEN_TTL_MS = 10 * 60 * 1000;

function getTokenSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET env var is required for token signing");
  }
  return secret;
}

/**
 * Sign a payload with HMAC-SHA256 using SESSION_SECRET.
 * Returns hex-encoded digest.
 */
function sign(payload: string): string {
  return createHmac("sha256", getTokenSecret()).update(payload).digest("hex");
}

/**
 * Generate a stateless, HMAC-signed magic link token.
 *
 * Format: base64url(email) + "." + expiresAt_hex + "." + hmac_hex
 *
 * Works across serverless instances — no shared state required.
 * Tokens are time-limited (10 min) but NOT single-use.
 */
export function generateMagicToken(email: string): string {
  const normalized = email.toLowerCase().trim();
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const emailB64 = Buffer.from(normalized).toString("base64url");
  const expHex = expiresAt.toString(16);
  const payload = `${emailB64}.${expHex}`;
  const sig = sign(payload);

  log.info("Magic link token generated", { email: normalized });
  return `${payload}.${sig}`;
}

/**
 * Verify an HMAC-signed magic link token.
 * Returns the email if valid, null if signature invalid or expired.
 */
export function verifyMagicToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    log.warn("Magic link token malformed");
    return null;
  }

  const [emailB64, expHex, providedSig] = parts;
  const payload = `${emailB64}.${expHex}`;
  const expectedSig = sign(payload);

  // Constant-time comparison to prevent timing attacks
  try {
    const a = Buffer.from(providedSig, "hex");
    const b = Buffer.from(expectedSig, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      log.warn("Magic link token signature invalid");
      return null;
    }
  } catch {
    log.warn("Magic link token signature comparison failed");
    return null;
  }

  const expiresAt = parseInt(expHex, 16);
  if (Date.now() > expiresAt) {
    log.warn("Magic link token expired");
    return null;
  }

  const email = Buffer.from(emailB64, "base64url").toString("utf-8");
  log.info("Magic link token verified", { email });
  return email;
}
