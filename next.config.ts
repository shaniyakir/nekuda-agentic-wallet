import type { NextConfig } from "next";

// instrumentationHook is enabled by default in Next.js 15+ (no longer experimental).
// instrumentation.ts is auto-loaded for Langfuse/OpenTelemetry tracing.
const nextConfig: NextConfig = {};

export default nextConfig;
