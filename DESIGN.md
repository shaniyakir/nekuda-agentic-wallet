# Design Document: Autonomous AI Buyer Agent

**Project Title:** Nekuda Agentic Wallet Integration  
**Architecture Style:** Full-Stack TypeScript Monolith (Next.js)  
**Developer:** Shani

---

## 1. Vision & Objective

Build a Buyer Agent capable of autonomous end-to-end commerce. The agent acts as a personal procurement assistant that navigates a merchant's catalog, manages a shopping cart, and executes secure payments using the **Nekuda Agentic Wallet**. The primary focus is demonstrating **Autonomous Execution** while maintaining **zero-exposure** of primary funding sources through PCI-compliant browser automation.

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
| Browser Automation | Playwright + @sparticuz/chromium | PCI-compliant checkout — types card credentials into Stripe Elements iframe (serverless-compatible) |
| Payments (client-side) | `@stripe/stripe-js`, `@stripe/react-stripe-js` | Stripe Elements for secure client-side card tokenization |
| Payments (server-side) | Stripe (Test Mode) | PaymentIntent creation from `pm_xxx` |
| Validation | Zod | Shared schemas for API, agent tools, and UI |
| Auth | `iron-session` + `resend` | Magic link email auth, encrypted httpOnly cookies |
| State Persistence | Vercel KV (`@upstash/redis`, `@upstash/ratelimit`) | Session, cart, and rate-limit state — survives serverless cold starts |
| Observability | Langfuse (via `@langfuse/otel` + OpenTelemetry) | Tracing tool calls, LLM completions, token usage |
| UI Components | shadcn/ui + Tailwind CSS + Lucide | Modern, accessible interface |

---

## 3. The Transaction Lifecycle (End-to-End)

1. **Wallet Setup:** User registers a payment method via `@nekuda/wallet` on the `/wallet` page.
2. **Discovery & Intent:** User asks the agent to shop. The agent browses the merchant catalog.
3. **Cart Management:** The agent creates a cart, adds products, and presents the selection.
4. **Checkout:** The agent freezes the cart. Prices are refreshed from the product repository (Price Integrity Validation).
5. **Staged Authorization (2-step Nekuda flow):**
   - `createMandate` — Request spending approval for the cart total.
   - `completeCheckout` — Reveal card credentials via Nekuda, fetch billing details, then complete payment via browser automation:
     1. `requestCardRevealToken(mandateId)` → reveal token
     2. `revealCardDetails(revealToken)` → card credentials (DPAN for Visa-tokenized cards)
     3. `getBillingDetails()` → name, address, phone
     4. Playwright navigates to `/checkout/[checkoutId]`, fills billing form + types card credentials into Stripe Elements iframe
     5. Stripe tokenizes client-side (iframe → Stripe servers) → `pm_xxx`
     6. Checkout page POSTs `pm_xxx` to `/api/checkout/[checkoutId]/pay`
     7. Server creates PaymentIntent with `pm_xxx` (never sees card data)
6. **Settlement:** Stripe processes payment using server-calculated amount (never trusting the agent). Cart transitions to `paid`.
7. **Cleanup:** Browser closed. Session marked as completed with 30-min TTL eviction.

---

## 4. Key Pages

| Route | Purpose | Key Components |
|-------|---------|----------------|
| `/` | Landing page | Hero, feature cards linking to each section |
| `/wallet` | Nekuda wallet setup | `MagicLinkForm`, `WalletManager`, `NekudaCvvCollector` |
| `/chat` | AI shopping assistant | `ChatInterface` with `useChat()`, `ToolCallDisplay` |
| `/dashboard` | Real-time agent state monitor | `CartPanel`, `NekudaPanel`, `StripePanel`, error display |
| `/checkout/[checkoutId]` | Browser-automated checkout | Cart summary, billing form, Stripe Elements card input |

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

## 6. Security Model (PCI-Compliant Browser Automation)

- **No server-side card transmission:** Card credentials are revealed via Nekuda and typed directly into a Stripe Elements iframe by headless Playwright. They flow browser → Stripe iframe → Stripe servers. The application server **never transmits card data over HTTP** — qualifying for PCI SAQ-A scope.
- **LLM sees only:** `{ success: true, last4: "XXXX" }` after checkout completion.
- **Ephemeral credentials:** Card data exists in server memory only during the `completeCheckout` tool execution (~seconds). It is never stored, logged, or persisted.
- **Server-side secrets:** `NEKUDA_API_KEY`, `STRIPE_SECRET_KEY`, `OPENAI_API_KEY` — never exposed to browser.
- **Client-side only:** `NEXT_PUBLIC_NEKUDA_PUBLIC_KEY` — used exclusively by wallet widget.
- **Auth:** Magic link via `iron-session` encrypted httpOnly cookies. No passwords stored.
- **Rate limiting:** Sliding-window per-userId limiter on the agent chat endpoint, persisted in Redis via `@upstash/ratelimit`.

---

## 7. Engineering Principles

- **Browser-Use PCI Compliance:** Card credentials are never transmitted over HTTP from the server. They are typed into Stripe's PCI-certified Elements iframe via browser automation, achieving SAQ-A compliance. The agent acts like a human shopper — it sees the credentials and types them into the secure payment form.
- **Price Integrity:** Prices recalculated from product repository at both checkout and payment — the agent's price is never trusted.
- **Repository Pattern:** `SessionStore` and `CartRepo` backed by Vercel KV (Upstash Redis) for persistence across serverless cold starts. `ProductRepo` remains in-memory (static catalog).
- **Direct Tool Invocation:** Agent tools call repositories directly (same process, no HTTP overhead).
- **Error Resilience:** All agent tools return error objects instead of throwing, enabling LLM-driven error recovery.
- **Session TTL:** Sessions evicted via Redis native TTL — 30 min for completed, 60 min for active. Carts expire after 2 hours.
- **Idempotent Payments:** Stripe PaymentIntent uses `idempotencyKey: pay_{checkoutId}` to prevent double charges.
