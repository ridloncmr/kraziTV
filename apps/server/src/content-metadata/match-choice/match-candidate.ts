import type { TmdbTitleSummary } from "@krazitv/media";

import type { MatchCandidate } from "../contracts.js";

/**
 * The candidate form of one TMDB search result, as the choice dialog and
 * the track mapping's series search offer it: unknown facts become null on
 * the wire.
 */
export function matchCandidateOf(summary: TmdbTitleSummary): MatchCandidate {
  return {
    tmdbId: summary.id,
    title: summary.title,
    releaseDate: summary.releaseDate ?? null,
    posterPath: summary.posterPath ?? null,
  };
}
