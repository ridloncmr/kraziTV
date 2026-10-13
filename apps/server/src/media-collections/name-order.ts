// Fixed locale so list order never depends on the host's locale settings.
const NAME_COLLATOR = new Intl.Collator("en", { sensitivity: "base" });

/**
 * Orders names case- and accent-insensitively, then by ID, so every
 * collection-domain listing sorts names one way and never ties.
 */
export function compareNames(
  a: { name: string; id: string | number },
  b: { name: string; id: string | number },
): number {
  return NAME_COLLATOR.compare(a.name, b.name) || compareExact(a.id, b.id);
}

/**
 * Orders by code unit or number, never by locale, for tie-breaks that must
 * come out the same on every host.
 */
export function compareExact<T extends string | number>(a: T, b: T): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
