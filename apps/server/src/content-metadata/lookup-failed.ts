import type { TmdbLookupFailure } from "@krazitv/media";

import type { MetadataRefusal } from "./contracts.js";

/**
 * Refuses an owner's match or mapping step because TMDB failed to answer.
 * The whole failure is kept, so the reply can tell a rejected key apart from
 * an outage and log the failure's message.
 */
export function lookupFailed(failure: TmdbLookupFailure): MetadataRefusal {
  return { kind: "lookup_failed", failure };
}
