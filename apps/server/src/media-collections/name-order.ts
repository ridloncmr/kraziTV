// Fixed locale so list order never depends on the host's locale settings.
const NAME_COLLATOR = new Intl.Collator("en", { sensitivity: "base" });

/**
 * Orders display text case- and accent-insensitively, the one way every
 * collection-domain name or title sorts.
 */
export function compareText(a: string, b: string): number {
  return NAME_COLLATOR.compare(a, b);
}

/** Orders names by `compareText`, then by ID, so a listing never ties. */
export function compareNames(
  a: { name: string; id: string | number },
  b: { name: string; id: string | number },
): number {
  return compareText(a.name, b.name) || compareExact(a.id, b.id);
}

/**
 * Orders by code unit or number, never by locale, for tie-breaks that must
 * come out the same on every host.
 */
export function compareExact<T extends string | number>(a: T, b: T): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
