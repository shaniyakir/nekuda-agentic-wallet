/**
 * Agent Session Store — Redis-backed session tracking with native TTL.
 *
 * Tracks agent state per session so the dashboard can poll for live updates.
 * Each tool call updates the relevant fields; the chat API reads/writes here.
 *
 * SECURITY: No card data or Stripe PaymentMethod IDs are stored here.
 * Card credentials are handled exclusively via browser automation — they flow
 * from Nekuda API → headless browser → Stripe Elements iframe → Stripe servers.
 *
 * TTL policy (managed by Redis):
 *   - New/active sessions: 60 min TTL
 *   - Completed sessions: TTL reduced to 30 min on terminal status
 *
 * Persistence: Survives serverless cold starts via Upstash Redis.
 */

import { createHash } from "crypto";
import type { AgentSessionState } from "@/lib/types";
import { redis } from "@/lib/redis";
import { createLogger, redactEmail } from "@/lib/logger";

const log = createLogger("SESSION");

// ---------------------------------------------------------------------------
// TTL configuration (in seconds for Redis)
// ---------------------------------------------------------------------------

/** How long to keep an active/abandoned session (60 min) */
const ACTIVE_TTL_SEC = 60 * 60;

/** How long to keep a completed session (30 min) */
const COMPLETED_TTL_SEC = 30 * 60;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface SessionEntry {
  state: AgentSessionState;
  createdAt: number;
  completedAt: number | null;
}

// ---------------------------------------------------------------------------
// Redis key helpers
// ---------------------------------------------------------------------------

function sessionKey(sessionId: string): string {
  return `session:${sessionId}`;
}

/**
 * One-way SHA-256 hash of an email address for PII-safe storage in Redis.
 * Deterministic so the state route can hash the auth email and compare.
 */
export function hashUserIdForStorage(email: string): string {
  return createHash("sha256")
    .update(email.toLowerCase().trim())
    .digest("hex")
    .slice(0, 32);
}

// ---------------------------------------------------------------------------
// Public API (all async)
// ---------------------------------------------------------------------------

/**
 * Create a fresh agent session state with sensible defaults.
 */
export function createSessionState(
  sessionId: string,
  userId: string
): AgentSessionState {
  return {
    sessionId,
    userId: hashUserIdForStorage(userId),
    cartId: null,
    cartStatus: null,
    cartTotal: null,
    checkoutId: null,
    mandateId: null,
    mandateStatus: null,
    browserCheckoutStatus: null,
    orderId: null,
    stripePaymentIntentId: null,
    paymentStatus: null,
    error: null,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Get a session by ID. Returns null if not found.
 */
export async function getSession(sessionId: string): Promise<AgentSessionState | null> {
  const entry = await redis.get<SessionEntry>(sessionKey(sessionId));
  if (!entry) return null;
  return entry.state;
}

const TERMINAL_PAYMENT_STATUSES = new Set(["succeeded", "failed"]);

/**
 * Get or create a session. If the session doesn't exist, creates a new one.
 * Terminal sessions (succeeded/failed) are automatically cleared so the
 * next chat interaction starts fresh.
 */
export async function getOrCreateSession(
  sessionId: string,
  userId: string
): Promise<AgentSessionState> {
  const existing = await getSession(sessionId);
  if (existing) {
    if (!TERMINAL_PAYMENT_STATUSES.has(existing.paymentStatus ?? "")) {
      return existing;
    }
    log.info("Clearing terminal session", { sessionId, status: existing.paymentStatus });
    await deleteSession(sessionId);
  }

  const state = createSessionState(sessionId, userId);
  const entry: SessionEntry = {
    state,
    createdAt: Date.now(),
    completedAt: null,
  };

  await redis.set(sessionKey(sessionId), entry, { ex: ACTIVE_TTL_SEC });
  log.info("Session created", { sessionId, userId: redactEmail(userId) });
  return state;
}

/**
 * Update specific fields of a session's state.
 * Returns the updated state, or null if the session doesn't exist.
 */
export async function updateSession(
  sessionId: string,
  updates: Partial<AgentSessionState>
): Promise<AgentSessionState | null> {
  const key = sessionKey(sessionId);
  const entry = await redis.get<SessionEntry>(key);
  if (!entry) {
    log.warn("Attempted to update non-existent session", { sessionId });
    return null;
  }

  // Merge updates
  Object.assign(entry.state, updates, {
    updatedAt: new Date().toISOString(),
  });

  // Track completion and adjust TTL
  const terminalStatuses = ["succeeded", "failed"];
  let ttl = ACTIVE_TTL_SEC;

  if (
    entry.state.paymentStatus &&
    terminalStatuses.includes(entry.state.paymentStatus) &&
    !entry.completedAt
  ) {
    entry.completedAt = Date.now();
    ttl = COMPLETED_TTL_SEC;
    log.info("Session completed", {
      sessionId,
      paymentStatus: entry.state.paymentStatus,
    });
  } else if (entry.completedAt) {
    ttl = COMPLETED_TTL_SEC;
  }

  await redis.set(key, entry, { ex: ttl });
  return entry.state;
}

/**
 * Delete a session explicitly.
 */
export async function deleteSession(sessionId: string): Promise<boolean> {
  const deleted = await redis.del(sessionKey(sessionId));
  if (deleted > 0) {
    log.info("Session deleted", { sessionId });
    return true;
  }
  return false;
}

/**
 * List all active sessions. Used by admin/debug endpoints.
 * Note: This scans Redis keys — use sparingly in production.
 */
export async function listSessions(): Promise<AgentSessionState[]> {
  const keys = await redis.keys("session:*");
  if (keys.length === 0) return [];

  const entries = await redis.mget<SessionEntry[]>(...keys);
  return entries
    .filter((entry): entry is SessionEntry => entry !== null)
    .map((entry) => entry.state);
}

/**
 * Get the approximate store size (for monitoring).
 * Note: This counts Redis keys — use sparingly in production.
 */
export async function getStoreSize(): Promise<number> {
  const keys = await redis.keys("session:*");
  return keys.length;
}
