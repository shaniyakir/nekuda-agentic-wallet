/**
 * Shared Zod schemas and TypeScript types.
 *
 * Single source of truth — used in API routes, agent tools, and React components.
 * Zod provides runtime validation + TypeScript inference in one definition.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Product
// ---------------------------------------------------------------------------

export const ProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  price: z.number().positive(),
  currency: z.string().default("USD"),
  stock: z.number().int().nonnegative(),
});

export type Product = z.infer<typeof ProductSchema>;

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------

export const CartStatusEnum = z.enum(["active", "checked_out", "paid"]);
export type CartStatus = z.infer<typeof CartStatusEnum>;

export const CartItemSchema = z.object({
  productId: z.string(),
  productName: z.string(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().positive(),
});

export type CartItem = z.infer<typeof CartItemSchema>;

export const CartSchema = z.object({
  id: z.string(),
  userId: z.string(),
  items: z.array(CartItemSchema),
  status: CartStatusEnum,
  total: z.number().nonnegative(),
});

export type Cart = z.infer<typeof CartSchema>;

// ---------------------------------------------------------------------------
// Order / Payment Response
// ---------------------------------------------------------------------------

export const OrderResponseSchema = z.object({
  orderId: z.string(),
  stripePaymentIntentId: z.string(),
  amount: z.number().positive(),
  currency: z.string(),
  status: z.string(),
});

export type OrderResponse = z.infer<typeof OrderResponseSchema>;

// ---------------------------------------------------------------------------
// API Request Bodies
// ---------------------------------------------------------------------------

export const CreateCartRequestSchema = z.object({
  userId: z.string().min(1, "userId is required"),
});

export const AddToCartRequestSchema = z.object({
  productId: z.string().min(1, "productId is required"),
  quantity: z.number().int().positive().default(1),
});

// ---------------------------------------------------------------------------
// Agent Session State (for dashboard monitoring)
// ---------------------------------------------------------------------------

export const AgentSessionStateSchema = z.object({
  sessionId: z.string(),
  userId: z.string().nullable(),

  // Merchant state
  cartId: z.string().nullable(),
  cartStatus: CartStatusEnum.nullable(),
  cartTotal: z.number().nullable(),
  checkoutId: z.string().nullable(),

  // Nekuda staged authorization
  mandateId: z.number().nullable(),
  mandateStatus: z.enum(["pending", "approved", "failed"]).nullable(),

  // Browser-use checkout progress
  browserCheckoutStatus: z.enum([
    "reveal_token_obtained",
    "card_revealed",
    "cvv_expired",
    "billing_obtained",
    "browser_filling",
    "completed",
    "failed",
  ]).nullable(),

  // Settlement
  orderId: z.string().nullable(),
  stripePaymentIntentId: z.string().nullable(),
  paymentStatus: z.enum(["pending", "succeeded", "failed"]).nullable(),

  // Error
  error: z.string().nullable(),

  // Timestamps
  updatedAt: z.string(),
});

export type AgentSessionState = z.infer<typeof AgentSessionStateSchema>;
