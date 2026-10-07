/** Request feedback renders an Error's message, so a non-Error rejection is wrapped rather than shown as "[object Object]". */
export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
