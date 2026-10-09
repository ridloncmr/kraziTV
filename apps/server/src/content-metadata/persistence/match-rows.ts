import { setImmediate as yieldToEventLoop } from "node:timers/promises";

import type { Insertable, Kysely } from "kysely";

import type { ContentFactsTable } from "../../database/schema/content-facts-table.js";
import type { MetadataMatchCandidateTable } from "../../database/schema/metadata-match-candidate-table.js";
import type { MetadataMatchTable } from "../../database/schema/metadata-match-table.js";
import type { MetadataProviderRefTable } from "../../database/schema/metadata-provider-ref-table.js";
import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import {
  jsonIdList,
  parameterChunks,
} from "../../database/writes/parameter-chunks.js";
import type { MetadataMatchRecord } from "../contracts.js";

/** The rows one record becomes; only a match has facts and a reference. */
interface MatchRows {
  match: Insertable<MetadataMatchTable>;
  facts?: Insertable<ContentFactsTable>;
  ref?: Insertable<MetadataProviderRefTable>;
  candidates: Insertable<MetadataMatchCandidateTable>[];
}

/**
 * Replaces each item's metadata rows with its record's, inside the caller's
 * transaction. The caller decides which items may change; this only writes,
 * so a scan's commit and the owner's choice store a decision the same way.
 */
export async function replaceMatchRows(
  trx: Kysely<DatabaseSchema>,
  entries: readonly { id: string; record: MetadataMatchRecord }[],
): Promise<void> {
  await deleteMatchRows(
    trx,
    entries.map(({ id }) => id),
  );
  const rows = entries.map(({ id, record }) => toRows(id, record));
  await insertChunked(
    trx,
    "metadata_matches",
    rows.map((row) => row.match),
  );
  await insertChunked(
    trx,
    "content_facts",
    rows.flatMap((row) => row.facts ?? []),
  );
  await insertChunked(
    trx,
    "metadata_provider_refs",
    rows.flatMap((row) => row.ref ?? []),
  );
  await insertChunked(
    trx,
    "metadata_match_candidates",
    rows.flatMap((row) => row.candidates),
  );
}

/**
 * Deletes every metadata row of these items, children before their decision,
 * leaving each as never looked up.
 */
export async function deleteMatchRows(
  trx: Kysely<DatabaseSchema>,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  for (const table of [
    "metadata_match_candidates",
    "metadata_provider_refs",
    "content_facts",
    "metadata_matches",
  ] as const) {
    await trx
      .deleteFrom(table)
      .where("media_item_id", "in", jsonIdList(ids))
      .execute();
  }
}

// Maps one record to its rows; the evidence keeps the hints, the query sent,
// and whether the owner chose the match.
function toRows(id: string, record: MetadataMatchRecord): MatchRows {
  if (record.kind === "extra") {
    return {
      match: {
        media_item_id: id,
        state: "unmatched",
        extra: 1,
        lookup_error: null,
        looked_up_at: null,
        evidence: JSON.stringify({ hints: record.hints }),
        matched_duration_ms: null,
      },
      candidates: [],
    };
  }
  const { lookup, lookedUpAt } = record;
  const match: Insertable<MetadataMatchTable> = {
    media_item_id: id,
    state: lookup.kind === "failed" ? "unmatched" : lookup.kind,
    extra: 0,
    lookup_error: lookup.kind === "failed" ? lookup.reason : null,
    looked_up_at: lookedUpAt,
    evidence: JSON.stringify({
      hints: record.hints,
      query: lookup.query,
      ...(record.chosen ? { chosen: true } : {}),
    }),
    matched_duration_ms: lookup.kind === "matched" ? record.durationMs : null,
  };
  if (lookup.kind === "ambiguous") {
    return {
      match,
      candidates: lookup.candidates.map((candidate, position) => ({
        media_item_id: id,
        position,
        tmdb_id: candidate.id,
        title: candidate.title,
        release_date: candidate.releaseDate ?? null,
        poster_path: candidate.posterPath ?? null,
      })),
    };
  }
  if (lookup.kind !== "matched") return { match, candidates: [] };
  const ref = {
    media_item_id: id,
    provider: "tmdb" as const,
    fetched_at: lookedUpAt,
  };
  if ("series" in lookup) {
    const { series, season, episodes } = lookup;
    const [first] = episodes;
    const titles = episodes.flatMap((episode) => episode.title ?? []);
    return {
      match,
      facts: {
        ...NO_MOVIE_FACTS,
        media_item_id: id,
        content_type: "episode",
        // A multi-episode file is titled by every episode it holds; one
        // untitled part leaves it unknown rather than reading as one episode.
        title: titles.length === episodes.length ? titles.join(" / ") : null,
        release_date: first?.airDate ?? null,
        genres: JSON.stringify(series.genres),
        description: first?.description ?? null,
        poster_path: series.posterPath ?? null,
        series_tmdb_id: series.id,
        series_name: series.title,
        season_number: season,
        episode_number: first?.number ?? null,
        last_episode_number: episodes.at(-1)?.number ?? null,
      },
      ref: { ...ref, external_kind: "tv", external_id: series.id },
      candidates: [],
    };
  }
  const { movie } = lookup;
  return {
    match,
    facts: {
      ...NO_EPISODE_FACTS,
      media_item_id: id,
      content_type: "movie",
      title: movie.title,
      release_date: movie.releaseDate ?? null,
      genres: JSON.stringify(movie.genres),
      franchise_tmdb_id: movie.franchise?.id ?? null,
      franchise_name: movie.franchise?.name ?? null,
      description: movie.description ?? null,
      poster_path: movie.posterPath ?? null,
    },
    ref: { ...ref, external_kind: "movie", external_id: movie.id },
    candidates: [],
  };
}

// The facts only a movie has, absent from an episode's.
const NO_MOVIE_FACTS = { franchise_tmdb_id: null, franchise_name: null };

// The facts only an episode has, absent from a movie's.
const NO_EPISODE_FACTS = {
  series_tmdb_id: null,
  series_name: null,
  season_number: null,
  episode_number: null,
  last_episode_number: null,
};

/**
 * Inserts rows a chunk per statement, yielding before each like the item
 * upserts, so a large first enrichment keeps the event loop responsive.
 */
async function insertChunked<
  T extends
    | "metadata_matches"
    | "content_facts"
    | "metadata_provider_refs"
    | "metadata_match_candidates",
>(
  trx: Kysely<DatabaseSchema>,
  table: T,
  rows: readonly Insertable<DatabaseSchema[T]>[],
): Promise<void> {
  for (const chunk of parameterChunks(rows)) {
    await yieldToEventLoop();
    await trx.insertInto(table).values(chunk).execute();
  }
}
