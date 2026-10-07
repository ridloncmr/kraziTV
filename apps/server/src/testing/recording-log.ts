import type { FastifyBaseLogger } from "fastify";

export interface RecordedLogLine {
  level: "info" | "warn" | "error";
  fields: unknown;
  message: unknown;
}

export interface RecordingLog extends Pick<
  FastifyBaseLogger,
  "info" | "warn" | "error"
> {
  /** Every line logged so far, oldest first. */
  readonly lines: RecordedLogLine[];
}

/**
 * Returns a logger that keeps each `info`, `warn`, and `error` call as a
 * structured line, so tests can assert what was logged without parsing output.
 */
export function recordingLog(): RecordingLog {
  const lines: RecordedLogLine[] = [];
  return {
    lines,
    info: (fields: unknown, message?: unknown) =>
      void lines.push({ level: "info", fields, message }),
    warn: (fields: unknown, message?: unknown) =>
      void lines.push({ level: "warn", fields, message }),
    error: (fields: unknown, message?: unknown) =>
      void lines.push({ level: "error", fields, message }),
  };
}
