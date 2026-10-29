/**
 * Counts a collection's missing members as not airing, in words, so the
 * warning on its card never relies on color.
 */
export function missingWords(count: number): string {
  return count === 1
    ? "1 missing — won't air until its file returns"
    : `${count} missing — won't air until their files return`;
}
