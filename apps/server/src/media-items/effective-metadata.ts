import { fromNullableSqliteBoolean } from "../database/columns/sqlite-boolean.js";
import type { MetadataMatchTable } from "../database/schema/metadata-match-table.js";
import type { ContentMetadata, CorrectableField } from "./contracts.js";

// How far a matched file's probed duration may drift from its match-time
// duration before it reads as a different file; probes of one file vary
// slightly, and a re-encode of the same episode needs no review.
const FILE_CHANGE_TOLERANCE_MS = 2_000;

/**
 * The metadata columns item reads select beside each item, aliased where a
 * name clashes with an item column or another table's. Each comes from a
 * left join, so it is null when the item has no row in that table.
 */
export const METADATA_COLUMNS = [
  "metadata_matches.state as match_state",
  "metadata_matches.extra",
  "metadata_matches.lookup_error",
  "metadata_matches.matched_duration_ms",
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
  "metadata_provider_refs.refresh_error",
  "metadata_provider_refs.expired_at",
  "metadata_corrections.title as corrected_title",
  "metadata_corrections.series_name as corrected_series_name",
  "metadata_corrections.season_number as corrected_season_number",
  "metadata_corrections.episode_number as corrected_episode_number",
  "metadata_corrections.tags",
] as const;

/** One item's `METADATA_COLUMNS` as selected. */
export interface MetadataColumns {
  match_state: MetadataMatchTable["state"] | null;
  extra: number | null;
  lookup_error: string | null;
  matched_duration_ms: number | null;
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
  refresh_error: string | null;
  expired_at: number | null;
  corrected_title: string | null;
  corrected_series_name: string | null;
  corrected_season_number: number | null;
  corrected_episode_number: number | null;
  tags: string | null;
}

/**
 * Decides the metadata an item shows from its match decision, accepted
 * facts, and the owner's corrections. Every item read goes through here, so
 * the rule for which facts win lives in one place: a correction wins over
 * the provider's fact. A corrected episode is a single episode, so it also
 * ends any multi-episode range the provider reported. An extra reports
 * `extra` rather than its stored `unmatched`, since it is never looked up.
 * Takes the item's probed duration too, to tell whether its file changed
 * since it was matched.
 */
export function effectiveMetadata(
  row: MetadataColumns & { duration_ms: number | null },
): ContentMetadata {
  const corrected: [CorrectableField, unknown][] = [
    ["title", row.corrected_title],
    ["seriesName", row.corrected_series_name],
    ["seasonNumber", row.corrected_season_number],
    ["episodeNumber", row.corrected_episode_number],
  ];
  return {
    matchState:
      row.match_state === null
        ? "not_looked_up"
        : fromNullableSqliteBoolean(row.extra)
          ? "extra"
          : row.match_state,
    lookupError: row.lookup_error,
    fileChanged:
      row.match_state === "matched" &&
      row.duration_ms !== null &&
      row.matched_duration_ms !== null &&
      Math.abs(row.duration_ms - row.matched_duration_ms) >
        FILE_CHANGE_TOLERANCE_MS,
    title: row.corrected_title ?? row.fact_title,
    seriesName: row.corrected_series_name ?? row.series_name,
    seasonNumber: row.corrected_season_number ?? row.season_number,
    episodeNumber: row.corrected_episode_number ?? row.episode_number,
    lastEpisodeNumber: row.corrected_episode_number ?? row.last_episode_number,
    releaseDate: row.release_date,
    genres: row.genres === null ? [] : (JSON.parse(row.genres) as string[]),
    franchiseName: row.franchise_name,
    description: row.description,
    posterPath: row.poster_path,
    refreshedAt: row.fetched_at,
    refreshError: row.refresh_error,
    tmdbDataExpired: row.expired_at !== null,
    tags: row.tags === null ? [] : (JSON.parse(row.tags) as string[]),
    correctedFields: corrected.flatMap(([field, value]) =>
      value === null ? [] : [field],
    ),
  };
}
