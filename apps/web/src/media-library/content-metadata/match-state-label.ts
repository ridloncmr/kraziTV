import type { ContentMetadata } from "../../http/contracts/media.js";

const LABELS: Record<ContentMetadata["matchState"], string> = {
  not_looked_up: "Not looked up",
  unmatched: "Unmatched",
  ambiguous: "Needs your choice",
  matched: "Matched",
  rejected: "Rejected",
  extra: "Extra",
};

/**
 * Names an item's match state for the owner. A failed lookup stays
 * `unmatched` on the server, but reads as a failure, not as TMDB having no
 * answer, so the owner knows a retry may help. A match whose file changed
 * reads as such, so the owner can find files waiting for review, and an
 * episode TMDB does not list says so, since its numbers are the file's.
 */
export function matchStateLabel(metadata: ContentMetadata): string {
  if (metadata.lookupError !== null) return "Lookup failed";
  if (metadata.fileChanged) return "File changed";
  if (metadata.episodeUnlisted) return "Matched; episode not listed on TMDB";
  return LABELS[metadata.matchState];
}
