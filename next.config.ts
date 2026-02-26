import type { NextConfig } from "next";

// instrumentationHook is enabled by default in Next.js 15+ (no longer experimental).
// instrumentation.ts is auto-loaded for Langfuse/OpenTelemetry tracing.
const nextConfig: NextConfig = {
  // Include @sparticuz/chromium binary files in serverless function bundles.
  // Required for browser automation on Vercel.
  outputFileTracingIncludes: {
    "/api/agent/chat": ["./node_modules/@sparticuz/chromium/**/*"],
  },
};

export default nextConfig;
