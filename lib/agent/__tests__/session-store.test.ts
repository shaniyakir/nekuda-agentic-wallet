import { describe, it, expect, beforeEach } from "vitest";
import {
  getOrCreateSession,
  getSession,
  updateSession,
  deleteSession,
  listSessions,
  getStoreSize,
  storeCredentials,
  getCredentials,
  clearCredentials,
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
    expect(session.credentialsRevealed).toBe(false);
    expect(session.credentialsRevealedAt).toBeNull();
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
});

describe("credential-vault", () => {
  const sid = `vault-${Date.now()}`;

  const mockCreds = {
    cardNumber: "4111111111111111",
    cardExpiry: "12/26",
    cvv: "123",
    cardholderName: "Test User",
    isVisaPayment: true,
    billingAddress: "123 Main St",
    zipCode: "10001",
  };

  it("stores and retrieves credentials", () => {
    storeCredentials(sid, mockCreds);
    const creds = getCredentials(sid);
    expect(creds).not.toBeNull();
    expect(creds?.cardNumber).toBe("4111111111111111");
    expect(creds?.cvv).toBe("123");
    expect(creds?.isVisaPayment).toBe(true);
    clearCredentials(sid);
  });

  it("returns null for non-existent credentials", () => {
    expect(getCredentials("nonexistent")).toBeNull();
  });

  it("clears credentials", () => {
    storeCredentials(sid, mockCreds);
    expect(getCredentials(sid)).not.toBeNull();
    clearCredentials(sid);
    expect(getCredentials(sid)).toBeNull();
  });

  it("credentials are cleaned up when session is deleted", () => {
    const deleteSid = `vault-delete-${Date.now()}`;
    getOrCreateSession(deleteSid, "user@test.com");
    storeCredentials(deleteSid, mockCreds);
    expect(getCredentials(deleteSid)).not.toBeNull();
    deleteSession(deleteSid);
    expect(getCredentials(deleteSid)).toBeNull();
  });

  it("overwrites credentials on re-store (credential refresh)", () => {
    storeCredentials(sid, mockCreds);
    storeCredentials(sid, { ...mockCreds, cvv: "999" });
    const creds = getCredentials(sid);
    expect(creds?.cvv).toBe("999");
    clearCredentials(sid);
  });
});
