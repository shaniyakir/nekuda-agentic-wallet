/**
 * Tests verifying that all cart mutation endpoints require authentication
 * and enforce ownership (the user can only access their own cart).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetSession = vi.fn();

vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

vi.mock("@/lib/merchant/cart-repo", () => {
  const carts = new Map<string, { id: string; userId: string; items: unknown[]; status: string; total: number }>();
  return {
    cartRepo: {
      create: (userId: string) => {
        const cart = { id: "cart_test", userId, items: [], status: "active", total: 0 };
        carts.set(cart.id, cart);
        return cart;
      },
      get: (id: string) => carts.get(id) ?? undefined,
      addItem: (_cartId: string, _productId: string, _qty: number) => ({ id: "cart_test", items: [], total: 0 }),
      checkout: (_cartId: string) => ({ id: "cart_test", items: [], total: 0, status: "checked_out" }),
    },
  };
});

import { POST as createCart } from "@/app/api/merchant/cart/route";
import { GET as getCart } from "@/app/api/merchant/cart/[id]/route";
import { POST as addToCart } from "@/app/api/merchant/cart/[id]/add/route";
import { POST as checkoutCart } from "@/app/api/merchant/cart/[id]/checkout/route";

function makeRequest(path: string, method = "GET", body?: unknown): Request {
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  return new Request(`http://localhost:3000${path}`, opts);
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("merchant cart routes — authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POST /api/merchant/cart returns 401 without session", async () => {
    mockGetSession.mockResolvedValue({ userId: null });
    const res = await createCart(makeRequest("/api/merchant/cart", "POST") as never);
    expect(res.status).toBe(401);
  });

  it("POST /api/merchant/cart succeeds with session", async () => {
    mockGetSession.mockResolvedValue({ userId: "user@test.com" });
    const res = await createCart(makeRequest("/api/merchant/cart", "POST") as never);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.userId).toBe("user@test.com");
  });

  it("GET /api/merchant/cart/:id returns 401 without session", async () => {
    mockGetSession.mockResolvedValue({ userId: null });
    const res = await getCart(makeRequest("/api/merchant/cart/cart_test") as never, makeParams("cart_test"));
    expect(res.status).toBe(401);
  });

  it("GET /api/merchant/cart/:id returns 403 for wrong owner", async () => {
    // First create a cart owned by user@test.com
    mockGetSession.mockResolvedValue({ userId: "user@test.com" });
    await createCart(makeRequest("/api/merchant/cart", "POST") as never);

    // Try to access it as another user
    mockGetSession.mockResolvedValue({ userId: "attacker@evil.com" });
    const res = await getCart(makeRequest("/api/merchant/cart/cart_test") as never, makeParams("cart_test"));
    expect(res.status).toBe(403);
  });

  it("POST /api/merchant/cart/:id/add returns 401 without session", async () => {
    mockGetSession.mockResolvedValue({ userId: null });
    const res = await addToCart(
      makeRequest("/api/merchant/cart/cart_test/add", "POST", { productId: "p1", quantity: 1 }) as never,
      makeParams("cart_test"),
    );
    expect(res.status).toBe(401);
  });

  it("POST /api/merchant/cart/:id/add returns 403 for wrong owner", async () => {
    mockGetSession.mockResolvedValue({ userId: "user@test.com" });
    await createCart(makeRequest("/api/merchant/cart", "POST") as never);

    mockGetSession.mockResolvedValue({ userId: "attacker@evil.com" });
    const res = await addToCart(
      makeRequest("/api/merchant/cart/cart_test/add", "POST", { productId: "p1", quantity: 1 }) as never,
      makeParams("cart_test"),
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/merchant/cart/:id/checkout returns 401 without session", async () => {
    mockGetSession.mockResolvedValue({ userId: null });
    const res = await checkoutCart(
      makeRequest("/api/merchant/cart/cart_test/checkout", "POST") as never,
      makeParams("cart_test"),
    );
    expect(res.status).toBe(401);
  });

  it("POST /api/merchant/cart/:id/checkout returns 403 for wrong owner", async () => {
    mockGetSession.mockResolvedValue({ userId: "user@test.com" });
    await createCart(makeRequest("/api/merchant/cart", "POST") as never);

    mockGetSession.mockResolvedValue({ userId: "attacker@evil.com" });
    const res = await checkoutCart(
      makeRequest("/api/merchant/cart/cart_test/checkout", "POST") as never,
      makeParams("cart_test"),
    );
    expect(res.status).toBe(403);
  });
});
