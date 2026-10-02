export type MediaProbeErrorCode =
  | "spawn_failed"
  | "timed_out"
  | "cancelled"
  | "output_limit_exceeded"
  | "exited_with_error"
  | "terminated_by_signal"
  | "invalid_json"
  | "invalid_metadata";

const MAX_MESSAGE_LENGTH = 300;

// Matching control characters is the point: these strip them from stderr.
/* eslint-disable no-control-regex */
// Terminal CSI (colour/cursor) and OSC (e.g. window title) sequences.
const TERMINAL_ESCAPES =
  /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]+/g;
/* eslint-enable no-control-regex */

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
    super(truncate(sanitizeProbeText(message)), options);
    this.name = "MediaProbeError";
    this.code = code;
  }
}

/** Reduces external text to one printable line with collapsed whitespace. */
export function sanitizeProbeText(text: string): string {
  return text
    .replace(TERMINAL_ESCAPES, "")
    .replace(CONTROL_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Caps stored messages; the ellipsis marks that detail was cut. */
function truncate(text: string): string {
  if (text.length <= MAX_MESSAGE_LENGTH) return text;
  return `${text.slice(0, MAX_MESSAGE_LENGTH - 1)}…`;
}
