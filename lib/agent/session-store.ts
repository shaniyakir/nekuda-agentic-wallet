/**
 * Agent Session Store — in-memory session tracking with TTL eviction.
 *
 * Tracks agent state per session so the dashboard can poll for live updates.
 * Each tool call updates the relevant fields; the chat API reads/writes here.
 *
 * SECURITY: Only Stripe PaymentMethod IDs are stored (never raw PAN/CVV).
 * Raw card data is tokenized immediately during reveal and discarded.
 * The vault is never exposed to the LLM, dashboard, or Langfuse traces.
 *
 * TTL eviction policy (lazy — checked on every get/set):
 *   - Completed sessions: evicted 30 min after completedAt
 *   - Abandoned sessions:  evicted 60 min after createdAt (never completed)
 *
 * Production upgrade: Replace with Redis for multi-instance deployments.
 */

import type { AgentSessionState } from "@/lib/types";
import { createLogger, redactEmail } from "@/lib/logger";

const log = createLogger("SESSION");

// ---------------------------------------------------------------------------
// TTL configuration
// ---------------------------------------------------------------------------

/** How long to keep a completed session (30 min) */
const COMPLETED_TTL_MS = 30 * 60 * 1000;

/** How long to keep an abandoned session (60 min) */
const ABANDONED_TTL_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface SessionEntry {
  state: AgentSessionState;
  createdAt: number;
  completedAt: number | null;
}

// ---------------------------------------------------------------------------
// globalThis-backed stores — survive Next.js dev-mode HMR recompilation.
// Without this, different route modules can get separate Map instances.
// ---------------------------------------------------------------------------

const g = globalThis as unknown as {
  __sessionStore?: Map<string, SessionEntry>;
  __paymentMethodVault?: Map<string, string>;
};

const store: Map<string, SessionEntry> = (g.__sessionStore ??= new Map());
const paymentMethodVault: Map<string, string> = (g.__paymentMethodVault ??= new Map());

/**
 * Store a Stripe PaymentMethod ID after tokenizing revealed card details.
 */
export function storePaymentMethodId(
  sessionId: string,
  paymentMethodId: string
): void {
  paymentMethodVault.set(sessionId, paymentMethodId);
  log.info("PaymentMethod ID stored in vault", { sessionId, paymentMethodId });
}

/**
 * Retrieve stored PaymentMethod ID for payment processing.
 */
export function getPaymentMethodId(sessionId: string): string | null {
  return paymentMethodVault.get(sessionId) ?? null;
}

/**
 * Clear PaymentMethod ID after payment or on session eviction.
 */
export function clearPaymentMethodId(sessionId: string): void {
  if (paymentMethodVault.delete(sessionId)) {
    log.info("PaymentMethod ID cleared from vault", { sessionId });
  }
}

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

const TERMINAL_PAYMENT_STATUSES = new Set(["succeeded", "failed"]);

/**
 * Get or create a session. If the session doesn't exist, creates a new one.
 * Terminal sessions (succeeded/failed) are automatically cleared so the
 * next chat interaction starts fresh.
 */
export function getOrCreateSession(
  sessionId: string,
  userId: string
): AgentSessionState {
  const existing = getSession(sessionId);
  if (existing) {
    if (!TERMINAL_PAYMENT_STATUSES.has(existing.paymentStatus ?? "")) {
      return existing;
    }
    log.info("Clearing terminal session", { sessionId, status: existing.paymentStatus });
    deleteSession(sessionId);
  }

  const state = createSessionState(sessionId, userId);
  store.set(sessionId, {
    state,
    createdAt: Date.now(),
    completedAt: null,
  });

  log.info("Session created", { sessionId, userId: redactEmail(userId) });
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
  paymentMethodVault.delete(sessionId);
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
      paymentMethodVault.delete(sessionId);
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
