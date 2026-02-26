import { describe, it, expect, beforeAll } from "vitest";
import {
  generateCheckoutToken,
  verifyCheckoutToken,
  CHECKOUT_TOKEN_COOKIE,
} from "@/lib/agent/checkout-token";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-32-chars-minimum-ok!";
});

describe("CHECKOUT_TOKEN_COOKIE", () => {
  it("has the expected cookie name", () => {
    expect(CHECKOUT_TOKEN_COOKIE).toBe("checkout-token");
  });
});

describe("generateCheckoutToken", () => {
  it("returns a 3-part dot-delimited token", () => {
    const token = generateCheckoutToken("cart_abc");
    const parts = token.split(".");
    expect(parts).toHaveLength(3);
  });

  it("encodes the checkoutId in the first segment", () => {
    const checkoutId = "cart_abc123";
    const token = generateCheckoutToken(checkoutId);
    const [idB64] = token.split(".");
    const decoded = Buffer.from(idB64, "base64url").toString("utf-8");
    expect(decoded).toBe(checkoutId);
  });

  it("embeds an expiry in the future", () => {
    const before = Date.now();
    const token = generateCheckoutToken("cart_xyz");
    const [, expHex] = token.split(".");
    const expiresAt = parseInt(expHex, 16);
    expect(expiresAt).toBeGreaterThan(before);
    // Should expire within 10 minutes
    expect(expiresAt).toBeLessThan(Date.now() + 10 * 60 * 1000);
  });
});

describe("verifyCheckoutToken", () => {
  it("returns true for a valid token matching the checkoutId", () => {
    const checkoutId = "cart_valid";
    const token = generateCheckoutToken(checkoutId);
    expect(verifyCheckoutToken(token, checkoutId)).toBe(true);
  });

  it("returns false when checkoutId does not match", () => {
    const token = generateCheckoutToken("cart_a");
    expect(verifyCheckoutToken(token, "cart_b")).toBe(false);
  });

  it("returns false for an empty token", () => {
    expect(verifyCheckoutToken("", "cart_x")).toBe(false);
  });

  it("returns false for a malformed token (wrong number of segments)", () => {
    expect(verifyCheckoutToken("abc.def", "cart_x")).toBe(false);
  });

  it("returns false when the signature has been tampered with", () => {
    const checkoutId = "cart_tamper";
    const token = generateCheckoutToken(checkoutId);
    const [idB64, expHex] = token.split(".");
    const tampered = `${idB64}.${expHex}.0000000000000000000000000000000000000000000000000000000000000000`;
    expect(verifyCheckoutToken(tampered, checkoutId)).toBe(false);
  });

  it("returns false for an expired token", () => {
    const checkoutId = "cart_expired";
    // Manually craft a token with expiry in the past
    const { createHmac } = require("crypto");
    const secret = process.env.SESSION_SECRET!;
    const idB64 = Buffer.from(checkoutId).toString("base64url");
    const expHex = (Date.now() - 1000).toString(16); // 1s in the past
    const payload = `${idB64}.${expHex}`;
    const sig = createHmac("sha256", secret).update(payload).digest("hex");
    const expiredToken = `${payload}.${sig}`;
    expect(verifyCheckoutToken(expiredToken, checkoutId)).toBe(false);
  });

  it("two different checkoutIds produce different tokens", () => {
    const t1 = generateCheckoutToken("cart_1");
    const t2 = generateCheckoutToken("cart_2");
    expect(t1).not.toBe(t2);
  });
});
