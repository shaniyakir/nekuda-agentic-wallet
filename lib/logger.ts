/**
 * Structured Logger with namespace prefixes.
 *
 * Provides consistent, parseable log output across all modules.
 * Each namespace gets its own logger instance with ISO timestamps
 * and structured metadata.
 *
 * Usage:
 *   const log = createLogger('MERCHANT');
 *   log.info('Cart created', { cartId, userId: redactEmail(userId) });
 *   // → 2026-02-18T12:00:00.000Z [MERCHANT] INFO Cart created {"cartId":"abc","userId":"u1"}
 */

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

type LogNamespace =
  | "MERCHANT"
  | "AGENT"
  | "NEKUDA"
  | "AUTH"
  | "STRIPE"
  | "SESSION"
  | "RATE_LIMIT";

interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

function formatMeta(meta?: Record<string, unknown>): string {
  if (!meta || Object.keys(meta).length === 0) return "";
  return " " + JSON.stringify(meta);
}

function emit(
  level: LogLevel,
  namespace: LogNamespace,
  message: string,
  meta?: Record<string, unknown>
): void {
  const timestamp = new Date().toISOString();
  const line = `${timestamp} [${namespace}] ${level} ${message}${formatMeta(meta)}`;

  switch (level) {
    case "ERROR":
      console.error(line);
      break;
    case "WARN":
      console.warn(line);
      break;
    case "DEBUG":
      console.debug(line);
      break;
    default:
      console.log(line);
  }
}

export function createLogger(namespace: LogNamespace): Logger {
  return {
    debug: (message, meta) => emit("DEBUG", namespace, message, meta),
    info: (message, meta) => emit("INFO", namespace, message, meta),
    warn: (message, meta) => emit("WARN", namespace, message, meta),
    error: (message, meta) => emit("ERROR", namespace, message, meta),
  };
}

/**
 * Derive a deterministic, PII-free session ID from a userId (email).
 * Uses djb2 hash → 12-char hex string. Works in both Node.js and browser.
 */
export function hashSessionId(userId: string): string {
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < userId.length; i++) {
    const c = userId.charCodeAt(i);
    h1 = ((h1 << 5) + h1 + c) >>> 0;
    h2 = ((h2 << 5) + h2 + c) >>> 0;
  }
  const hex = (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
  return `agent_${hex.slice(0, 12)}`;
}

/**
 * Redact an email for safe logging: "shani.yakir1@gmail.com" → "sh***@gm***.com"
 */
export function redactEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const [domainName, ...tldParts] = domain.split(".");
  const tld = tldParts.join(".");
  const redactedLocal = local.length <= 2 ? local[0] + "***" : local.slice(0, 2) + "***";
  const redactedDomain = domainName.length <= 2 ? domainName[0] + "***" : domainName.slice(0, 2) + "***";
  return `${redactedLocal}@${redactedDomain}.${tld}`;
}
