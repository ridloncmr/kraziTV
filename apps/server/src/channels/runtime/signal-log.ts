import type { SignalLogger } from "@krazitv/signal";
import type { FastifyBaseLogger } from "fastify";

/**
 * Adapts the server's pino logger to the signal port, which takes the message
 * first; signal context becomes structured fields, not message text.
 */
export function toSignalLogger(log: FastifyBaseLogger): SignalLogger {
  return {
    debug: (message, context = {}) => log.debug(context, message),
    info: (message, context = {}) => log.info(context, message),
    warn: (message, context = {}) => log.warn(context, message),
    error: (message, context = {}) => log.error(context, message),
  };
}
