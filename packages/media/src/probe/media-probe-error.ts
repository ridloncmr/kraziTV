import {
  sanitizeDiagnosticText,
  truncateDiagnosticText,
} from "@krazitv/process";

type MediaProbeErrorCode =
  | "spawn_failed"
  | "timed_out"
  | "cancelled"
  | "output_limit_exceeded"
  | "exited_with_error"
  | "terminated_by_signal"
  | "invalid_json"
  | "invalid_metadata";

const MAX_MESSAGE_LENGTH = 300;

/**
 * A failure to probe one file. The constructor sanitizes and truncates the
 * message, so it is always safe to store as the catalog item's probe error
 * however much external text (stderr, paths, OS errors) a caller embeds.
 */
export class MediaProbeError extends Error {
  readonly code: MediaProbeErrorCode;

  /** Enforces the storable-message invariant at the single point of creation. */
  constructor(
    code: MediaProbeErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(
      truncateDiagnosticText(
        sanitizeDiagnosticText(message),
        MAX_MESSAGE_LENGTH,
      ),
      options,
    );
    this.name = "MediaProbeError";
    this.code = code;
  }
}
