// Automatic collection fixtures for tests only; production code must never import this module.
import type { Insertable } from "kysely";

import type { ContentFactsTable } from "../database/schema/content-facts-table.js";
import type { MediaItemStatus } from "../database/schema/media-item-table.js";
import type { MatchableItem } from "../media-collections/criteria/matchable-items.js";
import { NO_CONTENT_METADATA } from "./metadata-match-fixtures.js";

/**
 * A cataloged episode of the TMDB series `seriesTmdbId` (null for none),
 * at a path under its series folder unless one is given.
 */
export function matchableEpisode(
  id: string,
  seriesTmdbId: number | null,
  facts: {
    season?: number | null;
    episode?: number | null;
    seriesName?: string;
    path?: string;
    status?: MediaItemStatus;
  } = {},
): MatchableItem {
  return {
    id,
    title: id,
    path: facts.path ?? `/tv/office/${id}.mkv`,
    status: facts.status ?? "available",
    durationMs: 1_320_000,
    metadata: {
      ...NO_CONTENT_METADATA,
      matchState: "matched",
      seriesName: facts.seriesName ?? "The Office",
      seasonNumber: facts.season === undefined ? 1 : facts.season,
      episodeNumber: facts.episode === undefined ? 1 : facts.episode,
    },
    identity: { seriesTmdbId, franchiseTmdbId: null },
  };
}

/** Accepted facts for an episode of `seriesTmdbId`, as a scan stores them. */
export function episodeFacts(
  mediaItemId: string,
  seriesTmdbId: number,
  season: number,
  episode: number,
): Insertable<ContentFactsTable> {
  return {
    media_item_id: mediaItemId,
    content_type: "episode",
    title: `Episode ${episode}`,
    release_date: null,
    genres: "[]",
    franchise_tmdb_id: null,
    franchise_name: null,
    description: null,
    poster_path: null,
    series_tmdb_id: seriesTmdbId,
    series_name: "The Office",
    season_number: season,
    episode_number: episode,
    last_episode_number: episode,
  };
}
