# ByteShop — AI-Powered Shopping with Secure Agentic Payments

ByteShop is a full-stack demo of an **AI shopping assistant** that can browse a product catalog, manage a cart, and complete checkout — entirely through natural-language chat. The payment flow is powered by [Nekuda](https://nekuda.ai/)'s agentic wallet: the agent obtains a spending mandate, reveals card credentials, and completes payment via **browser automation** — typing card details directly into a Stripe Elements iframe so they never travel over HTTP from the server. PCI SAQ-A compliant by design.

Built as a reference implementation for **agentic commerce**: the pattern where an AI agent executes multi-step workflows on behalf of a user, including making real (or sandboxed) financial transactions with explicit user authorization at each stage.

---

## Live Demo

> **https://nekuda-agentic-wallet.vercel.app/** 

**What the demo supports:**
- Sign in via magic link (email → encrypted cookie session)
- **Wallet page** (`/wallet`): Nekuda's embedded wallet UI (`@nekuda/wallet`) for adding/managing payment methods, with automatic CVV re-entry when the security code expires
- AI chat agent: browse products, build a cart, checkout
- Nekuda mandate → card reveal → browser-use checkout (Playwright + Stripe Elements)
- Real-time dashboard showing agent state, cart, and payment status
- Full Langfuse trace for every LLM call and tool invocation

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| AI Agent | Vercel AI SDK (`streamText`, tool-calling, `useChat`) |
| LLM | OpenAI `gpt-4o` |
| Agentic Wallet (backend) | Nekuda JS SDK (`createMandate` → `requestCardRevealToken` → `revealCardDetails` → `getBillingDetails`) |
| Wallet UI (frontend) | `@nekuda/wallet` (`NekudaWallet`, `NekudaCvvCollector`, `WalletProvider`) |
| Browser Automation | Playwright (headless Chromium) — PCI-compliant checkout |
| Payment UI | `@stripe/stripe-js`, `@stripe/react-stripe-js` (Stripe Elements) |
| Payment Processing | Stripe (PaymentIntent from `pm_xxx` — server never sees card data) |
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
                    │  completeCheckout:                      │
                    │    1. requestCardRevealToken ─────────► Nekuda API
                    │    2. revealCardDetails ──────────────► Nekuda API
                    │    3. getBillingDetails ──────────────► Nekuda API
                    │    4. Playwright (headless browser):    │
                    │       → navigate to /checkout/[id]      │
                    │       → fill billing form               │
                    │       → type card into Stripe iframe ─► Stripe (client-side tokenization)
                    │       → submit → pm_xxx                 │
                    │    5. /api/checkout/[id]/pay:           │
                    │       → paymentIntents.create(pm_xxx) ► Stripe API
                    └─────────────────────────────────────────┘
                              │
                    Langfuse OTel traces (no PII/card data)
```

**Key invariants:**
- Card data **never travels over HTTP** from the application server. It flows from server memory → Playwright keystrokes → Stripe Elements iframe → Stripe servers.
- The LLM only sees `{ success: true, last4: "XXXX", orderId }` after checkout.
- The server only receives `pm_xxx` (Stripe PaymentMethod ID) from the checkout page, never raw card data.

**State persistence:**
- Cart, session, and rate-limiter state is stored in **Vercel KV** (Upstash Redis), ensuring data survives serverless cold starts and scales across multiple instances.

---

## Core Flows

### Wallet Setup (prerequisite)

Visit `/wallet` → sign in via magic link → the embedded Nekuda wallet (`NekudaWallet`) lets the user add a payment method. The agent cannot create mandates until at least one card is registered. If the card's CVV expires, the wallet page surfaces a `NekudaCvvCollector` for re-entry.

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

### Payment Flow (Mandate → Browser-Use Checkout)

```
1. createMandate(checkoutId)
      → Nekuda: create spending mandate → mandateId
      → User pre-authorized this via Nekuda wallet setup

2. completeCheckout(checkoutId, mandateId)
      → Nekuda: requestCardRevealToken(mandateId) → revealToken
      → Nekuda: revealCardDetails(revealToken) → card credentials (DPAN for Visa)
      → Nekuda: getBillingDetails() → name, address, phone
      → Playwright: navigate to /checkout/[checkoutId]
      → Playwright: fill billing form (name, email, address, phone, zip)
      → Playwright: type card credentials into Stripe Elements iframe
      → Stripe Elements: tokenize client-side → pm_xxx
      → Checkout page: POST pm_xxx to /api/checkout/[checkoutId]/pay
      → Server: paymentIntents.create(pm_xxx) → succeeded
      → Return { success: true, orderId, last4: "xxxx", status: "succeeded" }
```

Card data is **never transmitted over HTTP** from the server — it flows through Playwright keystrokes directly into Stripe's PCI-certified iframe (SAQ-A compliance).

---

## Security Notes

| Risk | Mitigation |
|---|---|
| Card data over HTTP | Card credentials are typed into Stripe Elements iframe via browser automation — never sent over HTTP from the server (PCI SAQ-A) |
| Card data in server memory | Ephemeral — exists only during `completeCheckout` execution (~seconds), never stored or logged |
| Card data in Langfuse traces | Telemetry metadata only contains redacted userId + sessionId hash |
| Email in logs | `redactEmail()` truncates to `sh***@gm***.com` before any log call |
| Price manipulation | Checkout API re-calculates total from the product repository; LLM-provided amounts are ignored |
| Magic link replay (serverless) | HMAC-SHA256 signed tokens with 10-min TTL; stateless — works across Vercel instances |
| Session hijacking | iron-session encrypts the cookie with SESSION_SECRET (AES-256) |
| Stripe live keys in test | Client asserts `sk_test_` prefix on init and logs mode |
| Secret exposure | All secrets in Vercel Env Vars; `.env*` gitignored; `.env.example` has no real values |

---

## Local Setup

### Prerequisites

- Node.js ≥ 20
- npm (or pnpm/yarn)
- Playwright Chromium (`npx playwright install chromium`)
- Accounts: OpenAI, Nekuda, Stripe (test mode), Langfuse, Resend (optional)

### Install

```bash
git clone https://github.com/your-org/nekuda-agentic-wallet.git
cd nekuda-agentic-wallet
npm install
npx playwright install chromium
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
| `NEKUDA_API_KEY` | ✅ | Nekuda SDK API key (backend) |
| `NEXT_PUBLIC_NEKUDA_PUBLIC_KEY` | ✅ | Nekuda public key for the wallet UI (`@nekuda/wallet`) |
| `STRIPE_SECRET_KEY` | ✅ | Stripe secret key (`sk_test_...`) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | ✅ | Stripe publishable key (`pk_test_...`) |
| `SESSION_SECRET` | ✅ | ≥ 32 random chars — session encryption + HMAC signing |
| `UPSTASH_REDIS_REST_URL` | ✅ | Upstash Redis REST URL (from Vercel KV or Upstash console) |
| `UPSTASH_REDIS_REST_TOKEN` | ✅ | Upstash Redis REST token |
| `LANGFUSE_SECRET_KEY` | ✅ | Langfuse secret key |
| `LANGFUSE_PUBLIC_KEY` | ✅ | Langfuse public key |
| `LANGFUSE_BASEURL` | optional | Langfuse endpoint (defaults to `https://cloud.langfuse.com`) |
| `RESEND_API_KEY` | optional | Email for magic links (console fallback if absent) |
| `NEXT_PUBLIC_DEMO_MODE` | optional | Set to `"true"` to show magic link directly in UI (no email needed) |
| `NEXT_PUBLIC_APP_URL` | optional | Base URL for magic links (auto-detected from request) |
| `NEXT_PUBLIC_BASE_URL` | optional | Base URL for browser automation checkout (defaults to `http://localhost:3000`) |
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
