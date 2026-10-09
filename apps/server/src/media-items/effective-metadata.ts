import { fromNullableSqliteBoolean } from "../database/columns/sqlite-boolean.js";
import type { MetadataMatchTable } from "../database/schema/metadata-match-table.js";
import type { ContentMetadata } from "./contracts.js";

/**
 * The metadata columns item reads select beside each item, aliased where a
 * name clashes with an item column. Each comes from a left join, so it is
 * null when the item has no row in that table.
 */
export const METADATA_COLUMNS = [
  "metadata_matches.state as match_state",
  "metadata_matches.extra",
  "metadata_matches.lookup_error",
  "content_facts.title as fact_title",
  "content_facts.series_name",
  "content_facts.season_number",
  "content_facts.episode_number",
  "content_facts.last_episode_number",
  "content_facts.release_date",
  "content_facts.genres",
  "content_facts.franchise_name",
  "content_facts.description",
  "content_facts.poster_path",
  "metadata_provider_refs.fetched_at",
] as const;

/** One item's `METADATA_COLUMNS` as selected. */
export interface MetadataColumns {
  match_state: MetadataMatchTable["state"] | null;
  extra: number | null;
  lookup_error: string | null;
  fact_title: string | null;
  series_name: string | null;
  season_number: number | null;
  episode_number: number | null;
  last_episode_number: number | null;
  release_date: string | null;
  genres: string | null;
  franchise_name: string | null;
  description: string | null;
  poster_path: string | null;
  fetched_at: number | null;
}

/**
 * Decides the metadata an item shows from its match decision and accepted
 * facts. Every item read goes through here, so the rule for which facts win
 * lives in one place. An extra reports `extra` rather than its stored
 * `unmatched`, since it is never looked up.
 */
export function effectiveMetadata(row: MetadataColumns): ContentMetadata {
  return {
    matchState:
      row.match_state === null
        ? "not_looked_up"
        : fromNullableSqliteBoolean(row.extra)
          ? "extra"
          : row.match_state,
    lookupError: row.lookup_error,
    title: row.fact_title,
    seriesName: row.series_name,
    seasonNumber: row.season_number,
    episodeNumber: row.episode_number,
    lastEpisodeNumber: row.last_episode_number,
    releaseDate: row.release_date,
    genres: row.genres === null ? [] : (JSON.parse(row.genres) as string[]),
    franchiseName: row.franchise_name,
    description: row.description,
    posterPath: row.poster_path,
    refreshedAt: row.fetched_at,
  };
}
