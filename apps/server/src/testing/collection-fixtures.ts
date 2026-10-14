// Automatic collection fixtures for tests only; production code must never import this module.
import type { Insertable, Kysely } from "kysely";

import type { ContentFactsTable } from "../database/schema/content-facts-table.js";
import type { DatabaseSchema } from "../database/schema/database-schema.js";
import type { MediaItemStatus } from "../database/schema/media-item-table.js";
import type { MatchableItem } from "../media-collections/contracts.js";
import { rootFixture, titledItemFixture } from "./catalog-fixtures.js";
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
    /** Its TMDB facts expired: names dropped, identities and numbers kept. */
    expired?: boolean;
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
      tmdbDataExpired: facts.expired ?? false,
    },
    identity: { seriesTmdbId, franchiseTmdbId: null, tagIds: [] },
  };
}

/**
 * A cataloged movie in the TMDB collection `franchiseTmdbId` (null for
 * none), released `releaseDate` and titled `title` unless given.
 */
export function matchableMovie(
  id: string,
  franchiseTmdbId: number | null,
  facts: {
    releaseDate?: string | null;
    title?: string | null;
    path?: string;
    tagIds?: string[];
  } = {},
): MatchableItem {
  return {
    id,
    title: id,
    path: facts.path ?? `/movies/${id}.mkv`,
    status: "available",
    durationMs: 7_200_000,
    metadata: {
      ...NO_CONTENT_METADATA,
      matchState: "matched",
      title: facts.title === undefined ? id : facts.title,
      releaseDate: facts.releaseDate === undefined ? null : facts.releaseDate,
      franchiseName: "Indiana Jones Collection",
    },
    identity: {
      seriesTmdbId: null,
      franchiseTmdbId,
      tagIds: facts.tagIds ?? [],
    },
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

/**
 * Catalogs Office episodes as `[id, season, episode]` under the fixture
 * root, each with the facts a matched scan stores. Pass `withRoot: false`
 * to add episodes to a catalog that already has the root.
 */
export async function seedEpisodes(
  db: Kysely<DatabaseSchema>,
  episodes: readonly (readonly [string, number, number])[],
  options: { withRoot?: boolean } = {},
): Promise<void> {
  if (options.withRoot ?? true) {
    await db.insertInto("media_roots").values(rootFixture).execute();
  }
  await db
    .insertInto("media_items")
    .values(episodes.map(([id]) => titledItemFixture(id)))
    .execute();
  await db
    .insertInto("content_facts")
    .values(
      episodes.map(([id, season, episode]) =>
        episodeFacts(id, 2316, season, episode),
      ),
    )
    .execute();
}

/** Accepted facts for a movie in the TMDB collection `franchiseTmdbId`, as a scan stores them. */
export function movieFacts(
  mediaItemId: string,
  franchise: { tmdbId: number; name: string } | null,
  releaseDate: string | null,
): Insertable<ContentFactsTable> {
  return {
    media_item_id: mediaItemId,
    content_type: "movie",
    title: mediaItemId,
    release_date: releaseDate,
    genres: "[]",
    franchise_tmdb_id: franchise?.tmdbId ?? null,
    franchise_name: franchise?.name ?? null,
    description: null,
    poster_path: null,
    series_tmdb_id: null,
    series_name: null,
    season_number: null,
    episode_number: null,
    last_episode_number: null,
  };
}
