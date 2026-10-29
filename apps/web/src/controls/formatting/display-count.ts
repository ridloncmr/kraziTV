// Fixed locale, so counts read like the spec's messages everywhere.
const COUNT = new Intl.NumberFormat("en-US");

/** Formats a count with thousands separators, so 14,508 never reads as a code. */
export function displayCount(value: number): string {
  return COUNT.format(value);
}
