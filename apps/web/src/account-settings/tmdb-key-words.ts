import { displayCount } from "../controls/formatting/display-count.js";

/**
 * What Account Settings says once Set up TMDB saved a key (spec 0006):
 * how many files the lookup it started covers, or, when it started none or
 * could not start, only that the key is saved; whatever is left over, the
 * tray offers again.
 */
export function keySavedSentence(lookupCount: number): string {
  if (lookupCount === 0) return "Your TMDB key is saved.";
  const files = lookupCount === 1 ? "file" : "files";
  return `kraziTV is looking up ${displayCount(lookupCount)} ${files} on TMDB. Keep working; the tray will tell you when it's done.`;
}
