/**
 * Reduces a title to the form two titles are compared in: case, punctuation,
 * diacritics, and a leading "The" ignored, and `&` read as "and". Every other
 * word and number counts, so `Alien` and `Aliens` stay apart.
 */
export function normalizeTitle(title: string): string {
  const words = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words[0] === "the" && words.length > 1) words.shift();
  return words.join(" ");
}
