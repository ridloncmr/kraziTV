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
 * The owner's sentence for a stored TMDB failure, chosen by the kind the
 * server stores beside its text, never by the text, so a reworded reason
 * cannot change what the owner is told to do. A rejected key is the owner's
 * to fix, so the sentence says where; anything else, TMDB unreachable, an
 * HTTP answer, or a reply kraziTV could not read, is kraziTV's to retry, as
 * is a failure with no kind: one stored before migration 035, or a refresh's.
 */
export function tmdbFailureWords(
  kind: ContentMetadata["lookupErrorKind"],
): string {
  switch (kind) {
    case "key_rejected":
      return "TMDB rejected the key. Check it in Account Settings.";
    case "unreachable":
    case "http":
    case "unreadable":
    case null:
      return "TMDB could not be reached; kraziTV will try again.";
  }
}

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
