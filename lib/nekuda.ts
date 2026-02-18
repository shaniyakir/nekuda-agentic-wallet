/**
 * Nekuda SDK singleton client.
 *
 * Initializes once via `NekudaClient.fromEnv()`, reused across all requests.
 * Server-side only — uses `NEKUDA_API_KEY` from environment.
 *
 * Usage:
 *   import { nekuda } from '@/lib/nekuda';
 *   const user = nekuda.user(userId);
 *   const mandate = await user.createMandate(mandateData);
 */

import { NekudaClient } from "@nekuda/nekuda-js";
import { createLogger } from "@/lib/logger";

const log = createLogger("NEKUDA");

function createNekudaClient(): NekudaClient {
  const apiKey = process.env.NEKUDA_API_KEY;
  if (!apiKey) {
    throw new Error(
      "NEKUDA_API_KEY env var is required. Get it from https://app.nekuda.ai/"
    );
  }

  const client = new NekudaClient(apiKey, {
    // Use sandbox mode in development
    ...(process.env.NEKUDA_BASE_URL && {
      baseUrl: process.env.NEKUDA_BASE_URL,
    }),
  });

  log.info("Nekuda client initialized");
  return client;
}

/**
 * Singleton Nekuda client instance.
 * Lazy-initialized on first import (module-level, cached by Node.js module system).
 */
export const nekuda: NekudaClient = createNekudaClient();
