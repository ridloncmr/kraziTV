import { setImmediate as yieldToEventLoop } from "node:timers/promises";

import type { Insertable, Transaction } from "kysely";

import type { ContentFactsTable } from "../../database/schema/content-facts-table.js";
import type { MetadataMatchCandidateTable } from "../../database/schema/metadata-match-candidate-table.js";
import type { MetadataMatchTable } from "../../database/schema/metadata-match-table.js";
import type { MetadataProviderRefTable } from "../../database/schema/metadata-provider-ref-table.js";
import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import {
  jsonIdList,
  parameterChunks,
} from "../../database/writes/parameter-chunks.js";
import { isSettledMatch } from "../../content-metadata/settled-match.js";
import type { MetadataMatchRecord } from "../contracts.js";

/** The rows one record becomes; only a match has facts and a reference. */
interface MatchRows {
  match: Insertable<MetadataMatchTable>;
  facts?: Insertable<ContentFactsTable>;
  ref?: Insertable<MetadataProviderRefTable>;
  candidates: Insertable<MetadataMatchCandidateTable>[];
}

/**
 * Writes each record's metadata rows inside the scan's commit. A removed item
 * the scan rediscovered returns as newly discovered (spec 0010), so its old
 * decision is cleared first. Otherwise only an item with no decision, or an
 * unmatched non-extra one, takes a record: the scan read match states before
 * its lookups, so this re-check inside the transaction keeps a choice or
 * match made meanwhile from being overwritten.
 */
export async function writeMetadataMatches(
  trx: Transaction<DatabaseSchema>,
  itemIds: ReadonlyMap<string, string>,
  records: readonly MetadataMatchRecord[],
  rediscoveredIds: readonly string[],
): Promise<void> {
  await deleteMetadata(trx, rediscoveredIds);
  const staged = records.flatMap((record) => {
    const id = itemIds.get(record.pathKey);
    return id === undefined ? [] : [{ id, record }];
  });
  if (staged.length === 0) return;

  const settled = new Set(
    (
      await trx
        .selectFrom("metadata_matches")
        .select("media_item_id")
        .where("media_item_id", "in", jsonIdList(staged.map(({ id }) => id)))
        .where(isSettledMatch)
        .execute()
    ).map((row) => row.media_item_id),
  );
  const writable = staged.filter(({ id }) => !settled.has(id));
  await deleteMetadata(
    trx,
    writable.map(({ id }) => id),
  );

  const rows = writable.map(({ id, record }) => toRows(id, record));
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

// Deletes every metadata row of these items, children before their decision.
async function deleteMetadata(
  trx: Transaction<DatabaseSchema>,
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

// Maps one record to its rows; the evidence keeps the hints and the query sent.
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
    evidence: JSON.stringify({ hints: record.hints, query: lookup.query }),
    matched_duration_ms: lookup.kind === "matched" ? record.durationMs : null,
  };
  if (lookup.kind === "ambiguous") {
    return {
      match,
      candidates: lookup.candidates.map((movie, position) => ({
        media_item_id: id,
        position,
        tmdb_id: movie.id,
        title: movie.title,
        release_date: movie.releaseDate ?? null,
        poster_path: movie.posterPath ?? null,
      })),
    };
  }
  if (lookup.kind !== "matched") return { match, candidates: [] };
  const { movie } = lookup;
  return {
    match,
    facts: {
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
    ref: {
      media_item_id: id,
      provider: "tmdb",
      external_kind: "movie",
      external_id: movie.id,
      fetched_at: lookedUpAt,
    },
    candidates: [],
  };
}

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
  trx: Transaction<DatabaseSchema>,
  table: T,
  rows: readonly Insertable<DatabaseSchema[T]>[],
): Promise<void> {
  for (const chunk of parameterChunks(rows)) {
    await yieldToEventLoop();
    await trx.insertInto(table).values(chunk).execute();
  }
}
