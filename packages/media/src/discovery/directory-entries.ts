// Windows creates these at every volume root and restricts their contents, so
// traversing them would fail any scan of a whole drive, even one mounted on POSIX.
const OS_VOLUME_FOLDERS = new Set([
  "system volume information",
  "$recycle.bin",
]);

/**
 * Hidden entries and OS volume folders are never media, so discovery skips
 * them and folder browsing never offers them.
 */
export function isSkippedEntry(name: string): boolean {
  return name.startsWith(".") || OS_VOLUME_FOLDERS.has(name.toLowerCase());
}

/** Locale collation varies by environment; code-unit order does not. */
export function compareOrdinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
