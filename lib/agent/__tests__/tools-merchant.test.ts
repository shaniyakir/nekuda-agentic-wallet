import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock Redis (before any imports that use it)
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

// Mock external services before importing tools
vi.mock("@/lib/nekuda", () => ({
  nekuda: { user: () => ({}) },
}));
vi.mock("@/lib/stripe", () => ({
  stripe: { paymentIntents: { create: vi.fn() } },
}));

vi.mock("@/lib/agent/browser", () => ({
  extractCardCredentials: vi.fn(),
  completeCheckoutViasBrowser: vi.fn(),
  closeBrowser: vi.fn(),
}));

import { createToolSet, browseProducts } from "@/lib/agent/tools";
import {
  getOrCreateSession,
  getSession,
  deleteSession,
} from "@/lib/agent/session-store";

const toolOpts = { toolCallId: "test", messages: [] as never[], abortSignal: undefined as never };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function exec(t: { execute?: (...args: any[]) => any }, ...args: any[]): Promise<any> {
  return t.execute!(...args);
}

describe("merchant tools", () => {
  const sid = `tools-${Date.now()}`;
  const uid = "merchant-tools@test.com";
  let tools: ReturnType<typeof createToolSet>;

  beforeEach(async () => {
    mockStore.clear();
    await deleteSession(sid);
    await getOrCreateSession(sid, uid);
    tools = createToolSet({ sessionId: sid, userId: uid });
  });

  describe("browseProducts", () => {
    it("returns all 5 products with required fields", async () => {
      const result = await exec(browseProducts, {}, toolOpts);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(5);
      for (const p of result) {
        expect(p).toHaveProperty("id");
        expect(p).toHaveProperty("name");
        expect(p).toHaveProperty("description");
        expect(p).toHaveProperty("price");
        expect(p).toHaveProperty("stock");
        expect(p.price).toMatch(/^\$/);
      }
    });

    it("includes Wireless Headphones at $89.99", async () => {
      const result = await exec(browseProducts, {}, toolOpts);
      const headphones = result.find((p: { id: string }) => p.id === "prod_001");
      expect(headphones).toBeDefined();
      expect(headphones?.name).toBe("Wireless Headphones");
      expect(headphones?.price).toBe("$89.99");
    });
  });

  describe("createCart", () => {
    it("creates a cart and updates session", async () => {
      const result = await exec(tools.createCart, {}, toolOpts);
      expect(result).toHaveProperty("cartId");
      expect(result.status).toBe("active");

      const session = await getSession(sid);
      expect(session?.cartId).toBe(result.cartId);
      expect(session?.cartStatus).toBe("active");
    });
  });

  describe("addToCart", () => {
    it("adds a product and updates total", async () => {
      const cart = await exec(tools.createCart, {}, toolOpts);
      const result = await exec(tools.addToCart,
        { cartId: cart.cartId, productId: "prod_001", quantity: 2 },
        toolOpts
      );

      expect(result).not.toHaveProperty("error");
      expect(result.total).toBe("$179.98");
      expect(result.items).toHaveLength(1);
      expect(result.items[0].quantity).toBe(2);

      const session = await getSession(sid);
      expect(session?.cartTotal).toBe(179.98);
    });

    it("returns error for invalid product", async () => {
      const cart = await exec(tools.createCart, {}, toolOpts);
      const result = await exec(tools.addToCart,
        { cartId: cart.cartId, productId: "prod_999", quantity: 1 },
        toolOpts
      );
      expect(result).toHaveProperty("error");
    });

    it("returns error for invalid cart", async () => {
      const result = await exec(tools.addToCart,
        { cartId: "nonexistent", productId: "prod_001", quantity: 1 },
        toolOpts
      );
      expect(result).toHaveProperty("error");
    });
  });

  describe("removeFromCart", () => {
    it("removes an item and updates total", async () => {
      const cart = await exec(tools.createCart, {}, toolOpts);
      await exec(tools.addToCart,
        { cartId: cart.cartId, productId: "prod_001", quantity: 1 },
        toolOpts
      );
      await exec(tools.addToCart,
        { cartId: cart.cartId, productId: "prod_003", quantity: 1 },
        toolOpts
      );

      const result = await exec(tools.removeFromCart,
        { cartId: cart.cartId, productId: "prod_001" },
        toolOpts
      );
      expect(result).not.toHaveProperty("error");
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe("$49.99");
    });
  });

  describe("checkoutCart", () => {
    it("freezes cart and returns checkoutId", async () => {
      const cart = await exec(tools.createCart, {}, toolOpts);
      await exec(tools.addToCart,
        { cartId: cart.cartId, productId: "prod_005", quantity: 1 },
        toolOpts
      );

      const result = await exec(tools.checkoutCart,
        { cartId: cart.cartId },
        toolOpts
      );
      expect(result).not.toHaveProperty("error");
      expect(result.checkoutId).toBe(cart.cartId);
      expect(result.status).toBe("checked_out");
      expect(result.total).toBe("$39.99");

      const session = await getSession(sid);
      expect(session?.checkoutId).toBe(cart.cartId);
      expect(session?.cartStatus).toBe("checked_out");
    });

    it("rejects empty cart checkout", async () => {
      const cart = await exec(tools.createCart, {}, toolOpts);
      const result = await exec(tools.checkoutCart,
        { cartId: cart.cartId },
        toolOpts
      );
      expect(result).toHaveProperty("error");
    });

    it("rejects double checkout", async () => {
      const cart = await exec(tools.createCart, {}, toolOpts);
      await exec(tools.addToCart,
        { cartId: cart.cartId, productId: "prod_001", quantity: 1 },
        toolOpts
      );
      await exec(tools.checkoutCart, { cartId: cart.cartId }, toolOpts);
      const result = await exec(tools.checkoutCart, { cartId: cart.cartId }, toolOpts);
      expect(result).toHaveProperty("error");
    });
  });

  describe("cart ownership validation", () => {
    it("addToCart rejects cart owned by another user", async () => {
      const cart = await exec(tools.createCart, {}, toolOpts);

      const attackerTools = createToolSet({ sessionId: `attacker-${Date.now()}`, userId: "attacker@evil.com" });
      await getOrCreateSession(`attacker-${Date.now()}`, "attacker@evil.com");

      const result = await exec(attackerTools.addToCart,
        { cartId: cart.cartId, productId: "prod_001", quantity: 1 },
        toolOpts
      );
      expect(result).toHaveProperty("error");
      expect(result.error).toContain("does not belong");
    });

    it("removeFromCart rejects cart owned by another user", async () => {
      const cart = await exec(tools.createCart, {}, toolOpts);
      await exec(tools.addToCart,
        { cartId: cart.cartId, productId: "prod_001", quantity: 1 },
        toolOpts
      );

      const attackerTools = createToolSet({ sessionId: `attacker-${Date.now()}`, userId: "attacker@evil.com" });

      const result = await exec(attackerTools.removeFromCart,
        { cartId: cart.cartId, productId: "prod_001" },
        toolOpts
      );
      expect(result).toHaveProperty("error");
      expect(result.error).toContain("does not belong");
    });

    it("checkoutCart rejects cart owned by another user", async () => {
      const cart = await exec(tools.createCart, {}, toolOpts);
      await exec(tools.addToCart,
        { cartId: cart.cartId, productId: "prod_001", quantity: 1 },
        toolOpts
      );

      const attackerTools = createToolSet({ sessionId: `attacker-${Date.now()}`, userId: "attacker@evil.com" });

      const result = await exec(attackerTools.checkoutCart,
        { cartId: cart.cartId },
        toolOpts
      );
      expect(result).toHaveProperty("error");
      expect(result.error).toContain("does not belong");
    });

    it("addToCart allows the cart owner", async () => {
      const cart = await exec(tools.createCart, {}, toolOpts);
      const result = await exec(tools.addToCart,
        { cartId: cart.cartId, productId: "prod_001", quantity: 1 },
        toolOpts
      );
      expect(result).not.toHaveProperty("error");
    });
  });
});

describe("system prompt", () => {
  it("exports a non-empty string", async () => {
    const { SYSTEM_PROMPT } = await import("@/lib/agent/system-prompt");
    expect(typeof SYSTEM_PROMPT).toBe("string");
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(100);
  });

  it("references ByteShop not Nekuda as the store", async () => {
    const { SYSTEM_PROMPT } = await import("@/lib/agent/system-prompt");
    expect(SYSTEM_PROMPT).toContain("ByteShop");
    expect(SYSTEM_PROMPT).not.toContain("Nekuda Buyer Agent");
  });

  it("mentions AI isolation and browser automation security", async () => {
    const { SYSTEM_PROMPT } = await import("@/lib/agent/system-prompt");
    expect(SYSTEM_PROMPT).toContain("NEVER have access to full card numbers");
    expect(SYSTEM_PROMPT).toContain("browser automation");
  });

  it("references completeCheckout, not old tool names", async () => {
    const { SYSTEM_PROMPT } = await import("@/lib/agent/system-prompt");
    expect(SYSTEM_PROMPT).toContain("completeCheckout");
    expect(SYSTEM_PROMPT).not.toContain("**requestCardRevealToken**");
    expect(SYSTEM_PROMPT).not.toContain("**executePayment**");
    expect(SYSTEM_PROMPT).not.toContain("credential TTL");
    expect(SYSTEM_PROMPT).not.toContain("secure vault");
  });
});
