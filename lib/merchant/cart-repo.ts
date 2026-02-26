/**
 * Redis-backed Cart Repository.
 *
 * Manages the shopping cart lifecycle: active -> checked_out -> paid.
 * Total is always recalculated from items (never trusted from external input).
 *
 * Persistence: Survives serverless cold starts via Upstash Redis.
 * TTL: 2 hours (generous, covers full checkout flow).
 */

import { randomUUID } from "crypto";
import type { Cart, CartItem } from "@/lib/types";
import { redis } from "@/lib/redis";
import { productRepo } from "./product-repo";

/** Cart TTL in seconds (2 hours) */
const CART_TTL_SEC = 2 * 60 * 60;

function cartKey(cartId: string): string {
  return `cart:${cartId}`;
}

function recalcTotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
}

export const cartRepo = {
  async create(userId: string): Promise<Cart> {
    const cart: Cart = {
      id: randomUUID(),
      userId,
      items: [],
      status: "active",
      total: 0,
    };
    await redis.set(cartKey(cart.id), cart, { ex: CART_TTL_SEC });
    return cart;
  },

  async get(id: string): Promise<Cart | undefined> {
    const cart = await redis.get<Cart>(cartKey(id));
    return cart ?? undefined;
  },

  async addItem(
    cartId: string,
    productId: string,
    quantity: number = 1
  ): Promise<Cart | { error: string }> {
    const cart = await redis.get<Cart>(cartKey(cartId));
    if (!cart) return { error: "Cart not found" };
    if (cart.status !== "active") return { error: "Cart is not active" };

    const product = productRepo.getById(productId);
    if (!product) return { error: `Product ${productId} not found` };
    if (product.stock < quantity)
      return { error: `Insufficient stock for ${product.name}` };

    const existing = cart.items.find((i) => i.productId === productId);
    if (existing) {
      existing.quantity += quantity;
    } else {
      cart.items.push({
        productId,
        productName: product.name,
        quantity,
        unitPrice: product.price,
      });
    }

    cart.total = recalcTotal(cart.items);
    await redis.set(cartKey(cartId), cart, { ex: CART_TTL_SEC });
    return cart;
  },

  /**
   * Freeze the cart for checkout. Returns the cart with status "checked_out".
   * The cart.id doubles as the checkoutId.
   */
  async checkout(cartId: string): Promise<Cart | { error: string }> {
    const cart = await redis.get<Cart>(cartKey(cartId));
    if (!cart) return { error: "Cart not found" };
    if (cart.status !== "active") return { error: "Cart is already checked out or paid" };
    if (cart.items.length === 0) return { error: "Cart is empty" };

    // Recalculate total from product repo (Price Integrity)
    let total = 0;
    for (const item of cart.items) {
      const product = productRepo.getById(item.productId);
      if (!product) return { error: `Product ${item.productId} no longer exists` };
      item.unitPrice = product.price;
      total += product.price * item.quantity;
    }

    cart.total = total;
    cart.status = "checked_out";
    await redis.set(cartKey(cartId), cart, { ex: CART_TTL_SEC });
    return cart;
  },

  /**
   * Mark as paid and decrement stock.
   */
  async markPaid(cartId: string): Promise<Cart | { error: string }> {
    const cart = await redis.get<Cart>(cartKey(cartId));
    if (!cart) return { error: "Cart not found" };
    if (cart.status !== "checked_out") return { error: "Cart must be checked_out first" };

    // Decrement stock for each item
    for (const item of cart.items) {
      const ok = productRepo.updateStock(item.productId, item.quantity);
      if (!ok) return { error: `Failed to decrement stock for ${item.productId}` };
    }

    cart.status = "paid";
    await redis.set(cartKey(cartId), cart, { ex: CART_TTL_SEC });
    return cart;
  },

  /**
   * Reduce quantity of a specific item. Removes the item if quantity hits 0.
   */
  async reduceItem(
    cartId: string,
    productId: string,
    amount: number = 1
  ): Promise<Cart | { error: string }> {
    const cart = await redis.get<Cart>(cartKey(cartId));
    if (!cart) return { error: "Cart not found" };
    if (cart.status !== "active") return { error: "Cart is not active" };

    const idx = cart.items.findIndex((i) => i.productId === productId);
    if (idx === -1) return { error: `Product ${productId} not in cart` };

    cart.items[idx].quantity -= amount;
    if (cart.items[idx].quantity <= 0) {
      cart.items.splice(idx, 1);
    }

    cart.total = recalcTotal(cart.items);
    await redis.set(cartKey(cartId), cart, { ex: CART_TTL_SEC });
    return cart;
  },

  /**
   * Remove an entire line item from the cart.
   */
  async removeItem(cartId: string, productId: string): Promise<Cart | { error: string }> {
    const cart = await redis.get<Cart>(cartKey(cartId));
    if (!cart) return { error: "Cart not found" };
    if (cart.status !== "active") return { error: "Cart is not active" };

    const idx = cart.items.findIndex((i) => i.productId === productId);
    if (idx === -1) return { error: `Product ${productId} not in cart` };

    cart.items.splice(idx, 1);
    cart.total = recalcTotal(cart.items);
    await redis.set(cartKey(cartId), cart, { ex: CART_TTL_SEC });
    return cart;
  },

  /**
   * Clear all items from the cart.
   */
  async clear(cartId: string): Promise<Cart | { error: string }> {
    const cart = await redis.get<Cart>(cartKey(cartId));
    if (!cart) return { error: "Cart not found" };
    if (cart.status !== "active") return { error: "Cart is not active" };

    cart.items = [];
    cart.total = 0;
    await redis.set(cartKey(cartId), cart, { ex: CART_TTL_SEC });
    return cart;
  },
};
