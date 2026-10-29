/**
 * Reads a `datetime-local` value, which has no zone, as the browser's local
 * time and returns the API instant it names, or undefined when it is empty
 * or not a time.
 */
export function fromLocalInput(value: string): string | undefined {
  if (value === "") return undefined;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? undefined : instant.toISOString();
}

/** Writes an API instant as a `datetime-local` value in the browser's local time. */
export function toLocalInput(value: string): string {
  const instant = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return [
    `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}`,
    `T${pad(instant.getHours())}:${pad(instant.getMinutes())}`,
  ].join("");
}
