import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock Redis
// ---------------------------------------------------------------------------

const mockStore = new Map<string, unknown>();

vi.mock("@upstash/redis", () => {
  class MockRedis {
    get = vi.fn((key: string) => Promise.resolve(mockStore.get(key) ?? null));
    set = vi.fn((key: string, value: unknown) => {
      mockStore.set(key, value);
      return Promise.resolve("OK");
    });
    del = vi.fn((key: string) => {
      const existed = mockStore.has(key);
      mockStore.delete(key);
      return Promise.resolve(existed ? 1 : 0);
    });
    keys = vi.fn((pattern: string) => {
      const prefix = pattern.replace("*", "");
      return Promise.resolve(
        Array.from(mockStore.keys()).filter((k) => k.startsWith(prefix))
      );
    });
    mget = vi.fn((...keys: string[]) =>
      Promise.resolve(keys.map((k) => mockStore.get(k) ?? null))
    );
  }
  return { Redis: MockRedis };
});

import {
  getOrCreateSession,
  getSession,
  updateSession,
  deleteSession,
  listSessions,
  getStoreSize,
  hashUserIdForStorage,
} from "@/lib/agent/session-store";

describe("session-store", () => {
  const sid = `test-${Date.now()}`;
  const uid = "user@test.com";

  beforeEach(async () => {
    mockStore.clear();
  });

  it("creates a session with correct defaults", async () => {
    const session = await getOrCreateSession(sid, uid);
    expect(session.sessionId).toBe(sid);
    expect(session.userId).toBe(hashUserIdForStorage(uid));
    expect(session.cartId).toBeNull();
    expect(session.mandateId).toBeNull();
    expect(session.browserCheckoutStatus).toBeNull();
    expect(session.paymentStatus).toBeNull();
  });

  it("returns existing session on duplicate getOrCreate", async () => {
    const s1 = await getOrCreateSession(sid, uid);
    const s2 = await getOrCreateSession(sid, uid);
    expect(s1.sessionId).toBe(s2.sessionId);
    expect(s1.userId).toBe(s2.userId);
  });

  it("updates session fields", async () => {
    await getOrCreateSession(sid, uid);
    const updated = await updateSession(sid, { cartId: "cart_123", cartStatus: "active" });
    expect(updated?.cartId).toBe("cart_123");
    expect(updated?.cartStatus).toBe("active");
    expect(updated?.userId).toBe(hashUserIdForStorage(uid));
  });

  it("returns null when updating non-existent session", async () => {
    const result = await updateSession("nonexistent", { cartId: "x" });
    expect(result).toBeNull();
  });

  it("marks session completed on terminal payment status", async () => {
    await getOrCreateSession(sid, uid);
    await updateSession(sid, { paymentStatus: "succeeded" });
    const session = await getSession(sid);
    expect(session?.paymentStatus).toBe("succeeded");
  });

  it("resets terminal (succeeded) session on next getOrCreateSession", async () => {
    await getOrCreateSession(sid, uid);
    await updateSession(sid, { paymentStatus: "succeeded", cartId: "cart_old" });
    const fresh = await getOrCreateSession(sid, uid);
    expect(fresh.paymentStatus).toBeNull();
    expect(fresh.cartId).toBeNull();
  });

  it("resets terminal (failed) session on next getOrCreateSession", async () => {
    await getOrCreateSession(sid, uid);
    await updateSession(sid, { paymentStatus: "failed", cartId: "cart_old" });
    const fresh = await getOrCreateSession(sid, uid);
    expect(fresh.paymentStatus).toBeNull();
    expect(fresh.cartId).toBeNull();
  });

  it("preserves in-progress session on getOrCreateSession", async () => {
    await getOrCreateSession(sid, uid);
    await updateSession(sid, { paymentStatus: "pending", cartId: "cart_active" });
    const same = await getOrCreateSession(sid, uid);
    expect(same.paymentStatus).toBe("pending");
    expect(same.cartId).toBe("cart_active");
  });

  it("tracks browserCheckoutStatus through lifecycle", async () => {
    await getOrCreateSession(sid, uid);
    await updateSession(sid, { browserCheckoutStatus: "reveal_token_obtained" });
    expect((await getSession(sid))?.browserCheckoutStatus).toBe("reveal_token_obtained");

    await updateSession(sid, { browserCheckoutStatus: "browser_filling" });
    expect((await getSession(sid))?.browserCheckoutStatus).toBe("browser_filling");

    await updateSession(sid, { browserCheckoutStatus: "completed" });
    expect((await getSession(sid))?.browserCheckoutStatus).toBe("completed");
  });

  it("deletes a session", async () => {
    await getOrCreateSession(sid, uid);
    expect(await getSession(sid)).not.toBeNull();
    await deleteSession(sid);
    expect(await getSession(sid)).toBeNull();
  });

  it("lists sessions", async () => {
    const id1 = `list-test-1-${Date.now()}`;
    const id2 = `list-test-2-${Date.now()}`;
    await getOrCreateSession(id1, uid);
    await getOrCreateSession(id2, uid);
    const sessions = await listSessions();
    const ids = sessions.map((s) => s.sessionId);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
    await deleteSession(id1);
    await deleteSession(id2);
  });

  it("reports store size", async () => {
    const sizeBefore = await getStoreSize();
    const tempSid = `size-${Date.now()}`;
    await getOrCreateSession(tempSid, uid);
    expect(await getStoreSize()).toBe(sizeBefore + 1);
    await deleteSession(tempSid);
  });
});
