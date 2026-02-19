/**
 * Next.js Instrumentation — registers Langfuse span processor for
 * OpenTelemetry-based tracing. Captures every Vercel AI SDK call
 * (tool calls, LLM completions, token usage) automatically.
 *
 * Activated by setting `experimental_telemetry: { isEnabled: true }`
 * on streamText/generateText calls.
 *
 * @see https://langfuse.com/integrations/frameworks/vercel-ai-sdk
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { NodeSDK } = await import("@opentelemetry/sdk-node");
    const { LangfuseSpanProcessor } = await import("@langfuse/otel");

    const sdk = new NodeSDK({
      spanProcessors: [new LangfuseSpanProcessor()],
    });

    sdk.start();
  }
}
