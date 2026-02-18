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
// Payment Credentials (from Nekuda reveal)
// ---------------------------------------------------------------------------

export const PaymentCredentialsSchema = z.object({
  /** Full card number from Nekuda reveal */
  cardNumber: z.string(),
  /** Expiry in MM/YY format — mapped from SDK's card_exp */
  cardExpiry: z.string(),
  /**
   * Dynamic CVV — Valid for 60 minutes per Nekuda security specs.
   * Must be used within TTL window or a new reveal is required.
   * Mapped from SDK's card_cvv.
   */
  cvv: z.string(),
  /** Cardholder name — mapped from SDK's card_holder */
  cardholderName: z.string(),
});

export type PaymentCredentials = z.infer<typeof PaymentCredentialsSchema>;

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

export const PayRequestSchema = z.object({
  checkoutId: z.string().min(1, "checkoutId is required"),
  credentials: PaymentCredentialsSchema,
  /** Optional: mandate amount for price-drift logging (observability only) */
  mandateAmount: z.number().positive().optional(),
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
  revealTokenObtained: z.boolean(),
  credentialsRevealed: z.boolean(),

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
