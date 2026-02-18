/**
 * In-memory Cart Repository.
 *
 * Manages the shopping cart lifecycle: active -> checked_out -> paid.
 * Total is always recalculated from items (never trusted from external input).
 */

import { randomUUID } from "crypto";
import type { Cart, CartItem, CartStatus } from "@/lib/types";
import { productRepo } from "./product-repo";

const carts: Map<string, Cart> = new Map();

function recalcTotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
}

export const cartRepo = {
  create(userId: string): Cart {
    const cart: Cart = {
      id: randomUUID(),
      userId,
      items: [],
      status: "active",
      total: 0,
    };
    carts.set(cart.id, cart);
    return cart;
  },

  get(id: string): Cart | undefined {
    return carts.get(id);
  },

  addItem(
    cartId: string,
    productId: string,
    quantity: number = 1
  ): Cart | { error: string } {
    const cart = carts.get(cartId);
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
    return cart;
  },

  /**
   * Freeze the cart for checkout. Returns the cart with status "checked_out".
   * The cart.id doubles as the checkoutId.
   */
  checkout(cartId: string): Cart | { error: string } {
    const cart = carts.get(cartId);
    if (!cart) return { error: "Cart not found" };
    if (cart.status !== "active") return { error: "Cart is already checked out or paid" };
    if (cart.items.length === 0) return { error: "Cart is empty" };

    // Recalculate total from product repo (Price Integrity)
    let total = 0;
    for (const item of cart.items) {
      const product = productRepo.getById(item.productId);
      if (!product) return { error: `Product ${item.productId} no longer exists` };
      item.unitPrice = product.price; // Refresh price from source of truth
      total += product.price * item.quantity;
    }

    cart.total = total;
    cart.status = "checked_out";
    return cart;
  },

  /**
   * Mark as paid and decrement stock.
   */
  markPaid(cartId: string): Cart | { error: string } {
    const cart = carts.get(cartId);
    if (!cart) return { error: "Cart not found" };
    if (cart.status !== "checked_out") return { error: "Cart must be checked_out first" };

    // Decrement stock for each item
    for (const item of cart.items) {
      const ok = productRepo.updateStock(item.productId, item.quantity);
      if (!ok) return { error: `Failed to decrement stock for ${item.productId}` };
    }

    cart.status = "paid";
    return cart;
  },

  /**
   * Reduce quantity of a specific item. Removes the item if quantity hits 0.
   */
  reduceItem(
    cartId: string,
    productId: string,
    amount: number = 1
  ): Cart | { error: string } {
    const cart = carts.get(cartId);
    if (!cart) return { error: "Cart not found" };
    if (cart.status !== "active") return { error: "Cart is not active" };

    const idx = cart.items.findIndex((i) => i.productId === productId);
    if (idx === -1) return { error: `Product ${productId} not in cart` };

    cart.items[idx].quantity -= amount;
    if (cart.items[idx].quantity <= 0) {
      cart.items.splice(idx, 1);
    }

    cart.total = recalcTotal(cart.items);
    return cart;
  },

  /**
   * Remove an entire line item from the cart.
   */
  removeItem(cartId: string, productId: string): Cart | { error: string } {
    const cart = carts.get(cartId);
    if (!cart) return { error: "Cart not found" };
    if (cart.status !== "active") return { error: "Cart is not active" };

    const idx = cart.items.findIndex((i) => i.productId === productId);
    if (idx === -1) return { error: `Product ${productId} not in cart` };

    cart.items.splice(idx, 1);
    cart.total = recalcTotal(cart.items);
    return cart;
  },

  /**
   * Clear all items from the cart.
   */
  clear(cartId: string): Cart | { error: string } {
    const cart = carts.get(cartId);
    if (!cart) return { error: "Cart not found" };
    if (cart.status !== "active") return { error: "Cart is not active" };

    cart.items = [];
    cart.total = 0;
    return cart;
  },
};
