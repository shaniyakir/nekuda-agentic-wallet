/**
 * Structured Logger with namespace prefixes.
 *
 * Provides consistent, parseable log output across all modules.
 * Each namespace gets its own logger instance with ISO timestamps
 * and structured metadata.
 *
 * Usage:
 *   const log = createLogger('MERCHANT');
 *   log.info('Cart created', { cartId, userId });
 *   // → 2026-02-18T12:00:00.000Z [MERCHANT] INFO Cart created {"cartId":"abc","userId":"u1"}
 */

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

type LogNamespace =
  | "MERCHANT"
  | "AGENT"
  | "NEKUDA"
  | "AUTH"
  | "STRIPE"
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
