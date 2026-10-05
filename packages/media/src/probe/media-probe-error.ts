type MediaProbeErrorCode =
  | "spawn_failed"
  | "timed_out"
  | "cancelled"
  | "output_limit_exceeded"
  | "exited_with_error"
  | "terminated_by_signal"
  | "invalid_json"
  | "invalid_metadata";

import { sanitizeDiagnosticText } from "@krazitv/process";

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
    super(truncate(sanitizeDiagnosticText(message)), options);
    this.name = "MediaProbeError";
    this.code = code;
  }
}

/** Caps stored messages; the ellipsis marks that detail was cut. */
function truncate(text: string): string {
  if (text.length <= MAX_MESSAGE_LENGTH) return text;
  return `${text.slice(0, MAX_MESSAGE_LENGTH - 1)}…`;
}
