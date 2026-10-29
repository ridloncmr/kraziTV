import type { ContentMetadata } from "../../http/contracts/media.js";

/**
 * The owner's word for each match state. Every Media Library screen that
 * names a state, the item rows, Details, and the scan summary, reads it here,
 * so the words cannot drift apart.
 */
export const MATCH_STATE_LABELS: Record<ContentMetadata["matchState"], string> =
  {
    not_looked_up: "Not looked up",
    unmatched: "Unmatched",
    ambiguous: "Needs your choice",
    matched: "Matched",
    rejected: "Rejected",
    extra: "Extra",
  };

/** The word for a lookup that failed, which the server keeps as `unmatched`. */
export const LOOKUP_FAILED_LABEL = "Lookup failed";

/**
 * Names an item's match state for the owner. A failed lookup stays
 * `unmatched` on the server, but reads as a failure, not as TMDB having no
 * answer, so the owner knows a retry may help. A match whose file changed
 * reads as such, so the owner can find files waiting for review, and an
 * episode TMDB does not list says so, since its numbers are the file's.
 */
export function matchStateLabel(metadata: ContentMetadata): string {
  if (metadata.lookupError !== null) return LOOKUP_FAILED_LABEL;
  if (metadata.fileChanged) return "File changed";
  if (metadata.episodeUnlisted)
    return `${MATCH_STATE_LABELS.matched}; episode not listed on TMDB`;
  return MATCH_STATE_LABELS[metadata.matchState];
}
