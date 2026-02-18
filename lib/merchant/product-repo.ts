/**
 * In-memory Product Repository.
 *
 * Source of Truth for product prices — the merchant never trusts
 * the agent-provided price (Price Integrity Validation).
 *
 * Seeded with 5 demo products. Easily swappable with a real DB later.
 */

import type { Product } from "@/lib/types";

const products: Map<string, Product> = new Map([
  [
    "prod_001",
    {
      id: "prod_001",
      name: "Wireless Headphones",
      description: "Premium noise-cancelling wireless headphones with 30hr battery",
      price: 89.99,
      currency: "USD",
      stock: 15,
    },
  ],
  [
    "prod_002",
    {
      id: "prod_002",
      name: "Mechanical Keyboard",
      description: "RGB mechanical keyboard with Cherry MX switches",
      price: 129.99,
      currency: "USD",
      stock: 8,
    },
  ],
  [
    "prod_003",
    {
      id: "prod_003",
      name: "USB-C Hub",
      description: "7-in-1 USB-C hub with HDMI, SD card reader, and 100W PD",
      price: 49.99,
      currency: "USD",
      stock: 25,
    },
  ],
  [
    "prod_004",
    {
      id: "prod_004",
      name: "Webcam 4K",
      description: "Ultra HD webcam with auto-focus and noise-cancelling mic",
      price: 79.99,
      currency: "USD",
      stock: 12,
    },
  ],
  [
    "prod_005",
    {
      id: "prod_005",
      name: "Laptop Stand",
      description: "Adjustable aluminum laptop stand with ventilation",
      price: 39.99,
      currency: "USD",
      stock: 20,
    },
  ],
]);

export const productRepo = {
  listAll(): Product[] {
    return Array.from(products.values());
  },

  getById(id: string): Product | undefined {
    return products.get(id);
  },

  /**
   * Decrement stock after successful payment.
   * Returns false if insufficient stock.
   */
  updateStock(id: string, quantitySold: number): boolean {
    const product = products.get(id);
    if (!product) return false;
    if (product.stock < quantitySold) return false;
    product.stock -= quantitySold;
    return true;
  },
};
