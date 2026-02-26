/**
 * Upstash Redis client singleton.
 *
 * Uses environment variables auto-provisioned by Vercel KV:
 *   - KV_REST_API_URL
 *   - KV_REST_API_TOKEN
 *
 * Usage:
 *   import { redis } from "@/lib/redis";
 *   await redis.get("key");
 *   await redis.set("key", value, { ex: 3600 });
 */

import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});
