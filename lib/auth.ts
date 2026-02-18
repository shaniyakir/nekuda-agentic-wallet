/**
 * Authentication via Magic Link + iron-session.
 *
 * Flow:
 *   1. User enters email → POST /api/auth/magic-link → email sent with token link
 *   2. User clicks link → GET /api/auth/verify?token=x → session set, redirect to /wallet
 *   3. All subsequent requests read userId (email) from encrypted cookie
 *
 * The email IS the userId — passed to Nekuda's WalletProvider, agent tools,
 * and merchant cart. Consistent identity across sessions and devices.
 *
 * In dev mode (no RESEND_API_KEY), the magic link is logged to the console
 * for easy testing without an email service.
 */

import { randomUUID } from "crypto";
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
// Magic Link Token Store
// ---------------------------------------------------------------------------

interface MagicLinkToken {
  email: string;
  expiresAt: number;
}

/** In-memory token store. Tokens are single-use with a 10-minute TTL. */
const tokenStore = new Map<string, MagicLinkToken>();

/** TTL for magic link tokens (10 minutes) */
const TOKEN_TTL_MS = 10 * 60 * 1000;

/**
 * Generate a magic link token for the given email.
 * Returns the token string. Previous tokens for the same email are NOT
 * invalidated (the user might request multiple links).
 */
export function generateMagicToken(email: string): string {
  // Lazy prune expired tokens on every generation
  pruneExpiredTokens();

  const token = randomUUID();
  tokenStore.set(token, {
    email: email.toLowerCase().trim(),
    expiresAt: Date.now() + TOKEN_TTL_MS,
  });

  log.info("Magic link token generated", { email });
  return token;
}

/**
 * Verify and consume a magic link token.
 * Returns the email if valid, null if expired/invalid.
 * Token is single-use — deleted after verification.
 */
export function verifyMagicToken(token: string): string | null {
  const entry = tokenStore.get(token);
  if (!entry) {
    log.warn("Magic link token not found or already used");
    return null;
  }

  // Always delete (single-use)
  tokenStore.delete(token);

  if (Date.now() > entry.expiresAt) {
    log.warn("Magic link token expired", { email: entry.email });
    return null;
  }

  log.info("Magic link token verified", { email: entry.email });
  return entry.email;
}

/** Remove expired tokens to prevent memory leaks. */
function pruneExpiredTokens(): void {
  const now = Date.now();
  for (const [token, entry] of tokenStore) {
    if (now > entry.expiresAt) {
      tokenStore.delete(token);
    }
  }
}
