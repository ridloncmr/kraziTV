import type { LogContext, SignalLogger } from "../runtime/signal-logger.js";

type LogRecord = { message: string; context?: LogContext };

/** Retains info and error records so tests can assert lifecycle events and safe diagnostics. */
export class RecordingLogger implements SignalLogger {
  readonly infos: LogRecord[] = [];
  readonly errors: LogRecord[] = [];

  /** Ignores debug output, which no assertion depends on. */
  debug(): void {}

  /** Retains lifecycle measurements for stable event assertions. */
  info(message: string, context?: LogContext): void {
    this.infos.push({ message, context });
  }

  /** Ignores warnings, which no assertion depends on. */
  warn(): void {}

  /** Retains normalized failure diagnostics for assertions. */
  error(message: string, context?: LogContext): void {
    this.errors.push({ message, context });
  }
}
