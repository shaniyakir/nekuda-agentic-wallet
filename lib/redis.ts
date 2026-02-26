/**
 * Upstash Redis client singleton.
 *
 * Uses environment variables set by Vercel's Upstash integration:
 *   - UPSTASH_REDIS_REST_URL
 *   - UPSTASH_REDIS_REST_TOKEN
 *
 * Usage:
 *   import { redis } from "@/lib/redis";
 *   await redis.get("key");
 *   await redis.set("key", value, { ex: 3600 });
 */

import { Redis } from "@upstash/redis";

export const redis = Redis.fromEnv();
