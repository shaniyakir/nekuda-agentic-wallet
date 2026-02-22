# Design Document: Autonomous AI Buyer Agent

**Project Title:** Nekuda Agentic Wallet Integration  
**Architecture Style:** Full-Stack TypeScript Monolith (Next.js)  
**Developer:** Shani

---

## 1. Vision & Objective

Build a Buyer Agent capable of autonomous end-to-end commerce. The agent acts as a personal procurement assistant that navigates a merchant's catalog, manages a shopping cart, and executes secure payments using the **Nekuda Agentic Wallet**. The primary focus is demonstrating **Autonomous Execution** while maintaining **zero-exposure** of primary funding sources.

---

## 2. Core Architecture & Tech Stack

A single Next.js monolith providing frontend, API, and agent — deployed as one unit with end-to-end TypeScript type safety.

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Framework | Next.js 16 (App Router) | Full-stack React, API routes, SSR |
| Language | TypeScript (strict) | End-to-end type safety via Zod schemas |
| Wallet Frontend | `@nekuda/wallet` | Card collection & tokenization (React) |
| Wallet Backend | `@nekuda/nekuda-js` | Mandate creation, reveal tokens, JIT card credentials |
| Agent Engine | Vercel AI SDK (`ai`, `@ai-sdk/openai`, `@ai-sdk/react`) | Tool-calling agent loop, streaming, `useChat()` |
| Payments | Stripe (Test Mode) | Real-world settlement simulation |
| Validation | Zod | Shared schemas for API, agent tools, and UI |
| Auth | `iron-session` + `resend` | Magic link email auth, encrypted httpOnly cookies |
| Observability | Langfuse (via `@langfuse/otel` + OpenTelemetry) | Tracing tool calls, LLM completions, token usage |
| UI Components | shadcn/ui + Tailwind CSS + Lucide | Modern, accessible interface |

---

## 3. The Transaction Lifecycle (End-to-End)

1. **Wallet Setup:** User registers a payment method via `@nekuda/wallet` on the `/wallet` page.
2. **Discovery & Intent:** User asks the agent to shop. The agent browses the merchant catalog.
3. **Cart Management:** The agent creates a cart, adds products, and presents the selection.
4. **Checkout:** The agent freezes the cart. Prices are refreshed from the product repository (Price Integrity Validation).
5. **Staged Authorization (3-step Nekuda flow):**
   - `createMandate` — Request spending approval for the cart total.
   - `requestCardRevealToken` — Obtain reveal token, reveal card details ephemerally, **immediately tokenize via Stripe** (POST /v1/tokens → PaymentMethod `pm_xxx`). Raw card data is discarded — only the PM ID is stored in a lightweight `paymentMethodVault`.
   - `executePayment` — Read pre-created PaymentMethod ID from vault, create PaymentIntent with idempotency key. Clear PM ID after payment.
6. **Settlement:** Stripe processes payment using server-calculated amount (never trusting the agent). Cart transitions to `paid`.
7. **Cleanup:** PaymentMethod ID cleared from vault. Session marked as completed with 30-min TTL eviction.

---

## 4. Key Pages

| Route | Purpose | Key Components |
|-------|---------|----------------|
| `/` | Landing page | Hero, feature cards linking to each section |
| `/wallet` | Nekuda wallet setup | `MagicLinkForm`, `WalletManager`, `NekudaCvvCollector` |
| `/chat` | AI shopping assistant | `ChatInterface` with `useChat()`, `ToolCallDisplay` |
| `/dashboard` | Real-time agent state monitor | `CartPanel`, `NekudaPanel`, `StripePanel`, error display |

---

## 5. Component Architecture

```
UserProvider (root layout — session context)
  └── ChatProvider (singleton Chat instance, persists across navigations)
       └── Navbar (active-route highlighting, user identity)
            └── <page>
```

**Chat persistence:** The `Chat` instance from `@ai-sdk/react` is held in a React context at the root layout level. This ensures conversations (and cart state) survive page navigations.

**Dashboard polling:** The `StateMonitor` polls `GET /api/agent/state/{sessionId}` every 3 seconds. The `sessionId` is derived from the shared `ChatProvider` context, keeping it in sync with the chat.

---

## 6. Security Model (AI Isolation)

- **PaymentMethod Vault:** Raw card data (PAN, CVV, expiry) is **never stored**. Card details are revealed ephemerally and immediately tokenized into a Stripe PaymentMethod. Only the `pm_xxx` ID is stored in a server-side `Map` — never returned to the LLM, dashboard, or Langfuse traces.
- **LLM sees only:** `{ success: true, last4: "XXXX" }` after card reveal.
- **CVV TTL:** 60-minute window enforced by Nekuda. `executePayment` enforces a 55-minute safety margin.
- **Server-side secrets:** `NEKUDA_API_KEY`, `STRIPE_SECRET_KEY`, `OPENAI_API_KEY` — never exposed to browser.
- **Client-side only:** `NEXT_PUBLIC_NEKUDA_PUBLIC_KEY` — used exclusively by wallet widget.
- **Auth:** Magic link via `iron-session` encrypted httpOnly cookies. No passwords stored.
- **Rate limiting:** Sliding-window per-userId limiter on the agent chat endpoint.

---

## 7. Engineering Principles

- **Zero-Exposure:** Raw card data exists only as ephemeral local variables during tokenization — never persisted. Only Stripe PaymentMethod IDs are stored temporarily and cleared post-payment.
- **Price Integrity:** Prices recalculated from product repository at both checkout and payment — the agent's price is never trusted.
- **Repository Pattern:** In-memory stores (`ProductRepo`, `CartRepo`) abstracted behind async interfaces for future database migration.
- **Direct Tool Invocation:** Agent tools call repositories directly (same process, no HTTP overhead).
- **Error Resilience:** All agent tools return error objects instead of throwing, enabling LLM-driven error recovery.
- **Session TTL:** Completed sessions evicted after 30 min, abandoned after 60 min (lazy eviction on access).
- **Idempotent Payments:** Stripe PaymentIntent uses `idempotencyKey: pay_{checkoutId}` to prevent double charges. No separate pay HTTP endpoint — settlement is handled within the agent's `executePayment` tool.
