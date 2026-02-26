import { describe, it, expect, beforeEach } from "vitest";
import {
  getOrCreateSession,
  getSession,
  updateSession,
  deleteSession,
  listSessions,
  getStoreSize,
} from "@/lib/agent/session-store";

describe("session-store", () => {
  const sid = `test-${Date.now()}`;
  const uid = "user@test.com";

  beforeEach(() => {
    deleteSession(sid);
  });

  it("creates a session with correct defaults", () => {
    const session = getOrCreateSession(sid, uid);
    expect(session.sessionId).toBe(sid);
    expect(session.userId).toBe(uid);
    expect(session.cartId).toBeNull();
    expect(session.mandateId).toBeNull();
    expect(session.browserCheckoutStatus).toBeNull();
    expect(session.paymentStatus).toBeNull();
  });

  it("returns existing session on duplicate getOrCreate", () => {
    const s1 = getOrCreateSession(sid, uid);
    const s2 = getOrCreateSession(sid, uid);
    expect(s1).toBe(s2);
  });

  it("updates session fields", () => {
    getOrCreateSession(sid, uid);
    const updated = updateSession(sid, { cartId: "cart_123", cartStatus: "active" });
    expect(updated?.cartId).toBe("cart_123");
    expect(updated?.cartStatus).toBe("active");
    expect(updated?.userId).toBe(uid);
  });

  it("returns null when updating non-existent session", () => {
    const result = updateSession("nonexistent", { cartId: "x" });
    expect(result).toBeNull();
  });

  it("marks session completed on terminal payment status", () => {
    getOrCreateSession(sid, uid);
    updateSession(sid, { paymentStatus: "succeeded" });
    const session = getSession(sid);
    expect(session?.paymentStatus).toBe("succeeded");
  });

  it("resets terminal (succeeded) session on next getOrCreateSession", () => {
    getOrCreateSession(sid, uid);
    updateSession(sid, { paymentStatus: "succeeded", cartId: "cart_old" });
    const fresh = getOrCreateSession(sid, uid);
    expect(fresh.paymentStatus).toBeNull();
    expect(fresh.cartId).toBeNull();
  });

  it("resets terminal (failed) session on next getOrCreateSession", () => {
    getOrCreateSession(sid, uid);
    updateSession(sid, { paymentStatus: "failed", cartId: "cart_old" });
    const fresh = getOrCreateSession(sid, uid);
    expect(fresh.paymentStatus).toBeNull();
    expect(fresh.cartId).toBeNull();
  });

  it("preserves in-progress session on getOrCreateSession", () => {
    getOrCreateSession(sid, uid);
    updateSession(sid, { paymentStatus: "pending", cartId: "cart_active" });
    const same = getOrCreateSession(sid, uid);
    expect(same.paymentStatus).toBe("pending");
    expect(same.cartId).toBe("cart_active");
  });

  it("tracks browserCheckoutStatus through lifecycle", () => {
    getOrCreateSession(sid, uid);
    updateSession(sid, { browserCheckoutStatus: "reveal_token_obtained" });
    expect(getSession(sid)?.browserCheckoutStatus).toBe("reveal_token_obtained");

    updateSession(sid, { browserCheckoutStatus: "browser_filling" });
    expect(getSession(sid)?.browserCheckoutStatus).toBe("browser_filling");

    updateSession(sid, { browserCheckoutStatus: "completed" });
    expect(getSession(sid)?.browserCheckoutStatus).toBe("completed");
  });

  it("deletes a session", () => {
    getOrCreateSession(sid, uid);
    expect(getSession(sid)).not.toBeNull();
    deleteSession(sid);
    expect(getSession(sid)).toBeNull();
  });

  it("lists sessions", () => {
    const id1 = `list-test-1-${Date.now()}`;
    const id2 = `list-test-2-${Date.now()}`;
    getOrCreateSession(id1, uid);
    getOrCreateSession(id2, uid);
    const sessions = listSessions();
    const ids = sessions.map((s) => s.sessionId);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
    deleteSession(id1);
    deleteSession(id2);
  });

  it("reports store size", () => {
    const sizeBefore = getStoreSize();
    const tempSid = `size-${Date.now()}`;
    getOrCreateSession(tempSid, uid);
    expect(getStoreSize()).toBe(sizeBefore + 1);
    deleteSession(tempSid);
  });
});
