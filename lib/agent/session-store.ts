/**
 * Agent Session Store — in-memory session tracking with TTL eviction.
 *
 * Tracks agent state per session so the dashboard can poll for live updates.
 * Each tool call updates the relevant fields; the chat API reads/writes here.
 *
 * SECURITY: Card credentials are stored in a separate private vault (credentialVault).
 * The vault is never exposed to the LLM, dashboard, or Langfuse traces.
 * Only executePayment reads from it — credentials stay server-side at all times.
 *
 * TTL eviction policy (lazy — checked on every get/set):
 *   - Completed sessions: evicted 30 min after completedAt
 *   - Abandoned sessions:  evicted 60 min after createdAt (never completed)
 *
 * Production upgrade: Replace with Redis for multi-instance deployments.
 */

import type { AgentSessionState, PaymentCredentials } from "@/lib/types";
import { createLogger } from "@/lib/logger";

const log = createLogger("SESSION");

// ---------------------------------------------------------------------------
// TTL configuration
// ---------------------------------------------------------------------------

/** How long to keep a completed session (30 min) */
const COMPLETED_TTL_MS = 30 * 60 * 1000;

/** How long to keep an abandoned session (60 min) */
const ABANDONED_TTL_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Credential Vault — PAN/CVV isolation (never exposed to LLM or dashboard)
// ---------------------------------------------------------------------------

interface StoredCredentials extends PaymentCredentials {
  isVisaPayment: boolean;
  billingAddress: string | null;
  zipCode: string | null;
}

const credentialVault = new Map<string, StoredCredentials>();

/**
 * Store revealed card credentials server-side. Never returned to the LLM.
 */
export function storeCredentials(
  sessionId: string,
  credentials: StoredCredentials
): void {
  credentialVault.set(sessionId, credentials);
  log.info("Credentials stored in vault", { sessionId });
}

/**
 * Retrieve stored credentials for payment processing. Returns null if not found.
 */
export function getCredentials(sessionId: string): StoredCredentials | null {
  return credentialVault.get(sessionId) ?? null;
}

/**
 * Clear credentials after payment or on session eviction.
 */
export function clearCredentials(sessionId: string): void {
  if (credentialVault.delete(sessionId)) {
    log.info("Credentials cleared from vault", { sessionId });
  }
}

// ---------------------------------------------------------------------------
// Internal session entry — wraps AgentSessionState with timestamps
// ---------------------------------------------------------------------------

interface SessionEntry {
  state: AgentSessionState;
  createdAt: number;
  completedAt: number | null;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const store = new Map<string, SessionEntry>();

/**
 * Create a fresh agent session state with sensible defaults.
 */
export function createSessionState(
  sessionId: string,
  userId: string
): AgentSessionState {
  return {
    sessionId,
    userId,
    cartId: null,
    cartStatus: null,
    cartTotal: null,
    checkoutId: null,
    mandateId: null,
    mandateStatus: null,
    revealTokenObtained: false,
    credentialsRevealed: false,
    credentialsRevealedAt: null,
    orderId: null,
    stripePaymentIntentId: null,
    paymentStatus: null,
    error: null,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Get a session by ID. Returns null if not found or evicted.
 */
export function getSession(sessionId: string): AgentSessionState | null {
  evictExpired();
  const entry = store.get(sessionId);
  if (!entry) return null;
  return entry.state;
}

/**
 * Get or create a session. If the session doesn't exist, creates a new one.
 */
export function getOrCreateSession(
  sessionId: string,
  userId: string
): AgentSessionState {
  const existing = getSession(sessionId);
  if (existing) return existing;

  const state = createSessionState(sessionId, userId);
  store.set(sessionId, {
    state,
    createdAt: Date.now(),
    completedAt: null,
  });

  log.info("Session created", { sessionId, userId });
  return state;
}

/**
 * Update specific fields of a session's state.
 * Returns the updated state, or null if the session doesn't exist.
 */
export function updateSession(
  sessionId: string,
  updates: Partial<AgentSessionState>
): AgentSessionState | null {
  evictExpired();
  const entry = store.get(sessionId);
  if (!entry) {
    log.warn("Attempted to update non-existent session", { sessionId });
    return null;
  }

  // Merge updates
  Object.assign(entry.state, updates, {
    updatedAt: new Date().toISOString(),
  });

  // Track completion
  const terminalStatuses = ["succeeded", "failed"];
  if (
    entry.state.paymentStatus &&
    terminalStatuses.includes(entry.state.paymentStatus) &&
    !entry.completedAt
  ) {
    entry.completedAt = Date.now();
    log.info("Session completed", {
      sessionId,
      paymentStatus: entry.state.paymentStatus,
    });
  }

  return entry.state;
}

/**
 * Delete a session explicitly.
 */
export function deleteSession(sessionId: string): boolean {
  const deleted = store.delete(sessionId);
  credentialVault.delete(sessionId);
  if (deleted) {
    log.info("Session deleted", { sessionId });
  }
  return deleted;
}

/**
 * List all active (non-evicted) sessions. Used by admin/debug endpoints.
 */
export function listSessions(): AgentSessionState[] {
  evictExpired();
  return Array.from(store.values()).map((entry) => entry.state);
}

/**
 * Get the current store size (for monitoring).
 */
export function getStoreSize(): number {
  return store.size;
}

// ---------------------------------------------------------------------------
// TTL eviction (lazy — runs on every get/set)
// ---------------------------------------------------------------------------

function evictExpired(): void {
  const now = Date.now();
  let evictedCount = 0;

  for (const [sessionId, entry] of store) {
    const shouldEvict = entry.completedAt
      ? now - entry.completedAt > COMPLETED_TTL_MS // Completed: 30 min after completion
      : now - entry.createdAt > ABANDONED_TTL_MS; // Abandoned: 60 min after creation

    if (shouldEvict) {
      store.delete(sessionId);
      credentialVault.delete(sessionId);
      evictedCount++;
    }
  }

  if (evictedCount > 0) {
    log.info("Evicted expired sessions", {
      evictedCount,
      remaining: store.size,
    });
  }
}
