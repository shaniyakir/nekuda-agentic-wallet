# ByteShop — AI-Powered Shopping with Secure Agentic Payments

ByteShop is a full-stack demo of an **AI shopping assistant** that can browse a product catalog, manage a cart, and complete checkout — entirely through natural-language chat. The payment flow is powered by [Nekuda](https://nekuda.ai/)'s agentic wallet: the agent obtains a spending mandate, reveals card credentials via a time-limited token, tokenizes them through Stripe, and executes a `PaymentIntent` — all without raw card data ever touching the LLM or logs.

Built as a reference implementation for **agentic commerce**: the pattern where an AI agent executes multi-step workflows on behalf of a user, including making real (or sandboxed) financial transactions with explicit user authorization at each stage.

---

## Live Demo

> **[https://your-app.vercel.app](https://your-app.vercel.app)** ← replace with your Vercel URL

**What the demo supports:**
- Sign in via magic link (email → encrypted cookie session)
- AI chat agent: browse products, build a cart, checkout
- Nekuda mandate → card reveal → Stripe tokenization → payment
- Real-time dashboard showing agent state, cart, and payment status
- Full Langfuse trace for every LLM call and tool invocation

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| AI Agent | Vercel AI SDK (`streamText`, tool-calling, `useChat`) |
| LLM | OpenAI `gpt-4o` |
| Agentic Wallet | Nekuda JS SDK (`createMandate` → `requestCardRevealToken` → `revealCardDetails`) |
| Payment Processing | Stripe (PaymentIntent + server-side tokenization) |
| Auth | Magic link + iron-session (encrypted cookie) |
| Email | Resend (optional; falls back to console in dev) |
| Observability | Langfuse via OpenTelemetry (`@langfuse/otel` + Next.js instrumentation hook) |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Testing | Vitest |

---

## Architecture & Data Flow

```
Browser                  Next.js API Routes             External Services
───────                  ──────────────────             ─────────────────

[Chat UI]
  │  useChat()
  ▼
POST /api/agent/chat ──► streamText(gpt-4o)
                              │
                    ┌─────────┴──────────────────────────────┐
                    │         Tool Calls (server-side)        │
                    │                                         │
                    │  browseProducts ──► productRepo         │
                    │  createCart     ──► cartRepo            │
                    │  addToCart      ──► cartRepo            │
                    │  checkoutCart   ──► cartRepo            │
                    │                                         │
                    │  createMandate  ──────────────────────► Nekuda API
                    │                                         │
                    │  requestCardRevealToken:                │
                    │    1. requestCardRevealToken ─────────► Nekuda API
                    │    2. revealCardDetails ──────────────► Nekuda API
                    │    3. POST /v1/tokens (pk_test_) ─────► Stripe API
                    │    4. paymentMethods.create ──────────► Stripe API
                    │    5. store pm_xxx in session vault     │
                    │       (raw card data discarded)         │
                    │                                         │
                    │  executePayment:                        │
                    │    1. read pm_xxx from session vault    │
                    │    2. paymentIntents.create+confirm ──► Stripe API
                    │    3. clear pm_xxx from vault           │
                    └─────────────────────────────────────────┘
                              │
                    Langfuse OTel traces (no PII/card data)
```

**Key invariants:**
- Raw card data (PAN, CVV, expiry) exists only in ephemeral local variables during `requestCardRevealToken`, for ~100ms.
- The LLM only sees `{ success: true, last4: "XXXX" }` after tokenization.
- The in-process session vault holds only `pm_xxx` (Stripe PaymentMethod ID), which is useless without the secret key.

---

## Core Flows

### Browse → Cart → Checkout

```
User: "Show me the products"
  → browseProducts() → returns catalog

User: "Add 2x Wireless Headphones to my cart"
  → createCart() → cartId
  → addToCart(cartId, productId, qty=2)

User: "Checkout"
  → checkoutCart(cartId)
  → returns checkoutId + server-verified total
```

### Payment Flow (Mandate → Tokenize → PaymentIntent)

```
1. createMandate(product, price)
      → Nekuda: create spending mandate → mandateId
      → User pre-authorized this via Nekuda wallet setup

2. requestCardRevealToken(mandateId)
      → Nekuda: request reveal token
      → Nekuda: reveal card details (PAN, CVV, expiry)
      → Stripe: POST /v1/tokens with pk_test_ → tokenId
      → Stripe: paymentMethods.create(token) → pm_xxx
      → Store pm_xxx in server-side session vault
      → Discard raw card data
      → Return { success: true, last4: "4242" } to LLM

3. executePayment(checkoutId)
      → Read pm_xxx from vault (never the raw card)
      → Re-calculate total server-side (price integrity)
      → stripe.paymentIntents.create({ amount, payment_method: pm_xxx, confirm: true })
      → Clear pm_xxx from vault
      → Return { orderId, stripePaymentIntentId, status: "succeeded" }
```

---

## Security Notes

| Risk | Mitigation |
|---|---|
| Raw card data in logs | PAN/CVV/expiry are ephemeral local variables; never logged, never returned to LLM |
| Card data in Langfuse traces | Telemetry metadata only contains redacted userId + sessionId hash |
| Email in logs | `redactEmail()` truncates to `sh***@gm***.com` before any log call |
| Price manipulation | `executePayment` re-calculates total from the product repository; LLM-provided amounts are ignored |
| Magic link replay (serverless) | HMAC-SHA256 signed tokens with 10-min TTL; stateless — works across Vercel instances |
| Session hijacking | iron-session encrypts the cookie with SESSION_SECRET (AES-256) |
| Stripe live keys in test | Client asserts `sk_test_` prefix on init and logs mode |
| Secret exposure | All secrets in Vercel Env Vars; `.env*` gitignored; `.env.example` has no real values |

---

## Local Setup

### Prerequisites

- Node.js ≥ 20
- npm (or pnpm/yarn)
- Accounts: OpenAI, Nekuda, Stripe (test mode), Langfuse, Resend (optional)

### Install

```bash
git clone https://github.com/your-org/nekuda-agentic-wallet.git
cd nekuda-agentic-wallet
npm install
```

### Environment Variables

```bash
cp .env.example .env.local
# Fill in .env.local — see comments in the file for where to get each key
```

**All required vars:**

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | ✅ | OpenAI API key (gpt-4o) |
| `NEKUDA_API_KEY` | ✅ | Nekuda SDK API key |
| `STRIPE_SECRET_KEY` | ✅ | Stripe secret key (`sk_test_...`) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | ✅ | Stripe publishable key (`pk_test_...`) |
| `SESSION_SECRET` | ✅ | ≥ 32 random chars — session encryption + HMAC signing |
| `LANGFUSE_SECRET_KEY` | ✅ | Langfuse secret key |
| `LANGFUSE_PUBLIC_KEY` | ✅ | Langfuse public key |
| `RESEND_API_KEY` | optional | Email for magic links (console fallback if absent) |
| `NEXT_PUBLIC_DEMO_MODE` | optional | Set to `"true"` to show magic link directly in UI (no email needed) |
| `NEXT_PUBLIC_APP_URL` | optional | Base URL for magic links (auto-detected from request) |
| `NEKUDA_BASE_URL` | optional | Nekuda base URL override (sandbox) |

Generate `SESSION_SECRET`:
```bash
openssl rand -base64 32
```

### Run Dev Server

```bash
npm run dev
# → http://localhost:3000
```

**Dev tip (no Resend key):** After entering your email in `/wallet`, the magic link is printed to the terminal. Copy and paste it into your browser.

**Demo deployment:** Set `NEXT_PUBLIC_DEMO_MODE=true` in your Vercel environment variables. The magic link will appear as a "Sign in now" button directly in the UI — no email delivery required. This is useful for live demos and interviewer access without configuring a custom email domain.

### Run Tests

```bash
npm test
```

