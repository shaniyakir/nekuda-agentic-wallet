/**
 * Agent Chat Endpoint — POST /api/agent/chat
 *
 * Streaming agent chat powered by Vercel AI SDK + OpenAI with:
 * - Session-scoped tools (merchant + Nekuda + Stripe)
 * - iron-session auth (userId from encrypted cookie)
 * - Sliding-window rate limiting (per userId)
 * - Langfuse tracing via OpenTelemetry (automatic with experimental_telemetry)
 *
 * The frontend connects via useChat() → toUIMessageStreamResponse().
 */

import {
  streamText,
  stepCountIs,
  convertToModelMessages,
  type UIMessage,
} from "ai";
import { openai } from "@ai-sdk/openai";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { agentRateLimiter, getRetryAfterSeconds, logRateLimitExceeded } from "@/lib/rate-limit";
import { createToolSet } from "@/lib/agent/tools";
import { SYSTEM_PROMPT } from "@/lib/agent/system-prompt";
import { getOrCreateSession, hashUserIdForStorage } from "@/lib/agent/session-store";
import { createLogger, redactEmail, hashSessionId } from "@/lib/logger";

const log = createLogger("AGENT");

export async function POST(request: Request) {
  // 1. Auth — read userId from encrypted cookie
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json(
      { error: "Unauthorized. Please log in first." },
      { status: 401 }
    );
  }

  const userId = session.userId;

  // 2. Rate limit — per hashed userId (PII-safe Redis keys)
  const hashedUserId = hashUserIdForStorage(userId);
  const rateResult = await agentRateLimiter.limit(hashedUserId);
  if (!rateResult.success) {
    logRateLimitExceeded(hashedUserId, rateResult);
    return NextResponse.json(
      { error: "Rate limit exceeded. Please wait before sending another message." },
      { status: 429, headers: { "Retry-After": String(getRetryAfterSeconds(rateResult)) } }
    );
  }

  // 3. Parse request body (Vercel AI SDK format: { messages, id? })
  let messages: UIMessage[];
  let sessionId: string;

  try {
    const body = await request.json();
    messages = body.messages ?? [];
    sessionId = body.id ?? hashSessionId(userId);
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  if (!messages.length) {
    return NextResponse.json(
      { error: "No messages provided" },
      { status: 400 }
    );
  }

  // 4. Ensure agent session exists for dashboard tracking (Redis-backed)
  await getOrCreateSession(sessionId, userId);

  // 5. Create session-scoped tools
  const tools = createToolSet({ sessionId, userId });

  const safeUserId = redactEmail(userId);

  log.info("Agent chat request", {
    userId: safeUserId,
    sessionId,
    messageCount: messages.length,
    remaining: rateResult.remaining,
  });

  // 6. Stream response with Langfuse telemetry
  const result = streamText({
    model: openai("gpt-4o"),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(15),
    experimental_telemetry: {
      isEnabled: true,
      metadata: { userId: safeUserId, sessionId },
    },
    onError: ({ error }) => {
      log.error("streamText error", {
        userId: safeUserId,
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    },
    onFinish: ({ steps, usage }) => {
      log.info("Agent chat completed", {
        userId: safeUserId,
        sessionId,
        steps: steps.length,
        totalTokens: usage.totalTokens,
      });
    },
  });

  return result.toUIMessageStreamResponse();
}
