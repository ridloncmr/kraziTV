import type { ContentMetadata } from "../../http/contracts.js";

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
 * answer, so the owner knows a retry may help.
 */
export function matchStateLabel(metadata: ContentMetadata): string {
  return metadata.lookupError !== null
    ? "Lookup failed"
    : LABELS[metadata.matchState];
}
