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
| Agent Engine | Vercel AI SDK (`ai`, `@ai-sdk/openai`) | Tool-calling agent loop, streaming responses |
| Payments | Stripe (Test Mode) | Real-world settlement simulation |
| Validation | Zod | Shared schemas for API, agent tools, and UI |
| Observability | Langfuse | Tracing, prompt management |
| UI Components | shadcn/ui + Tailwind CSS + Lucide | Modern, accessible interface |

---

## 3. The Transaction Lifecycle (End-to-End)

1. **Wallet Setup:** User registers a payment method via `@nekuda/wallet` on the `/wallet` page.
2. **Discovery & Intent:** User asks the agent to shop. The agent browses the merchant catalog.
3. **Cart Management:** The agent creates a cart, adds products, and presents the selection.
4. **Checkout:** The agent freezes the cart. Prices are refreshed from the product repository (Price Integrity Validation).
5. **Staged Authorization (3-step Nekuda flow):**
   - `createMandate` — Request spending approval for the cart total.
   - `requestCardRevealToken` — Obtain a short-lived token after mandate approval.
   - `revealCardDetails` — Fetch JIT card credentials (Dynamic CVV, 60-min TTL).
6. **Settlement:** The agent submits credentials to the `/pay` endpoint, which processes payment via Stripe using the **server-calculated** amount (never trusting the agent).
7. **Confirmation:** Cart transitions to `paid`, stock is decremented, and the user receives order confirmation via streaming chat.

---

## 4. Key Pages

| Route | Purpose |
|-------|---------|
| `/wallet` | Nekuda wallet setup — card collection via `@nekuda/wallet` SDK |
| `/chat` | Conversational agent interface — `useChat()` with streaming |
| `/dashboard` | Real-time state monitor — cart, mandate, reveal, Stripe status |

---

## 5. Engineering Principles

- **Zero-Exposure:** Credentials exist only during the settlement phase and are never stored by the agent. Post-settlement cleanup clears mandate, token, and credential state.
- **Price Integrity:** The merchant API is the source of truth. Prices are recalculated from the product repository at checkout and payment — the agent's price is never trusted.
- **Repository Pattern:** In-memory data stores (`ProductRepo`, `CartRepo`) abstracted for future scaling to external databases.
- **Direct Tool Invocation:** Agent tools call repositories directly (same Node.js process) — zero HTTP overhead, full type safety. API routes exist in parallel for external access.
- **Error Resilience:** All agent tools return error strings instead of throwing, allowing the LLM to reason about failures and retry or inform the user.
- **Observability:** Langfuse integration for tracing agent decisions, tool calls, and prompt management.

---

## 6. Security Model

- Server-side only: `NEKUDA_API_KEY`, `STRIPE_SECRET_KEY`, `OPENAI_API_KEY` — never exposed to the browser.
- Client-side only: `NEXT_PUBLIC_NEKUDA_PUBLIC_KEY` — used exclusively by the wallet widget.
- Dynamic CVV with 60-minute TTL per Nekuda security specs.
- Stripe PaymentIntent uses `automatic_payment_methods` with `allow_redirects: "never"` for agent-compatible flow.
