const MAX_SUMMARY_LENGTH = 300;
const REDACTED = "[redacted]";

// Matching control characters is the point: these strip them from stderr.
/* eslint-disable no-control-regex */
// Terminal CSI (colour/cursor) and OSC (e.g. window title) sequences.
const TERMINAL_ESCAPES =
  /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]+/g;
/* eslint-enable no-control-regex */

/**
 * Reduces external text to one printable line with collapsed whitespace, so a
 * child's output can never forge log lines or emit terminal sequences.
 */
export function sanitizeDiagnosticText(text: string): string {
  return text
    .replace(TERMINAL_ESCAPES, "")
    .replace(CONTROL_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns a child's last meaningful stderr line, which is where FFmpeg and
 * ffprobe state why they failed, or undefined when there is none. Each
 * `redactions` value is replaced before sanitizing, so a caller can keep a
 * media path out of logs even when the path holds spaces. The result is
 * bounded so one runaway line cannot flood a log.
 */
export function summarizeStderr(
  stderrTail: Buffer,
  redactions: readonly string[] = [],
): string | undefined {
  let text = stderrTail.toString("utf8");
  for (const value of redactions) {
    if (value !== "") text = text.replaceAll(value, REDACTED);
  }
  const lastLine = text
    .split(/\r?\n/)
    .map(sanitizeDiagnosticText)
    .filter((line) => line !== "")
    .at(-1);
  return lastLine === undefined
    ? undefined
    : truncateDiagnosticText(lastLine, MAX_SUMMARY_LENGTH);
}

/**
 * Caps diagnostic text at `maxLength` characters, with an ellipsis marking
 * that detail was cut, so every logged or stored diagnostic is bounded alike.
 */
export function truncateDiagnosticText(
  text: string,
  maxLength: number,
): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}
