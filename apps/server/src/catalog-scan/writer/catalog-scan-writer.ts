import { randomUUID } from "node:crypto";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";

import type { Insertable, Kysely, Transaction } from "kysely";

import {
  fromSqliteBoolean,
  toSqliteBoolean,
} from "../../database/columns/sqlite-boolean.js";
import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import type { MediaItemTable } from "../../database/schema/media-item-table.js";
import { runImmediateTransaction } from "../../database/writes/immediate-transaction.js";
import {
  jsonIdList,
  parameterChunks,
} from "../../database/writes/parameter-chunks.js";
import type { RecordSources } from "../../database/writes/record-sources.js";
import type {
  DecisionRead,
  MetadataMatchRecord,
  RetryEntry,
} from "../../content-metadata/contracts.js";
import { replaceMatchRows } from "../../content-metadata/persistence/match-rows.js";
import type { CatalogCandidate, RootRejection } from "../contracts.js";
import { admitRoot } from "../root-admission.js";
import { writeMetadataMatches } from "./write-metadata-matches.js";

/** A fully staged scan of one root, ready to replace that root's catalog state. */
interface CatalogGeneration {
  rootId: string;
  /** Final scan timestamp: `lastSeenAt` for every item and the root's `lastScannedAt`. */
  scannedAt: number;
  /** Every discovered file, in path-identity order. */
  candidates: readonly CatalogCandidate[];
  /** Enrichment's records for some candidates; a scan without lookups has none. */
  metadataMatches?: readonly MetadataMatchRecord[];
}

type CommitGenerationResult =
  { kind: "committed"; missingCount: number } | RootRejection;

/**
 * The only scan component with database access. It applies a whole staged
 * generation in one transaction so a scan either replaces the root's catalog
 * state completely or leaves the previous state untouched, and commits a
 * lookup retry's decisions the same all-or-nothing way.
 */
export class CatalogScanWriter {
  readonly #db: Kysely<DatabaseSchema>;
  readonly #createId: () => string;

  // The ID source is injectable so tests can assert exact inserted rows.
  constructor(
    db: Kysely<DatabaseSchema>,
    options: Pick<RecordSources, "createId"> = {},
  ) {
    this.#db = db;
    this.#createId = options.createId ?? randomUUID;
  }

  /**
   * Upserts candidates and their metadata matches, marks unseen items
   * missing, and records the scan time.
   * The root is re-read inside the transaction so a root disabled, deleted,
   * or removed during the scan can never receive a late generation; a removed
   * root reads as not found.
   */
  async commit(generation: CatalogGeneration): Promise<CommitGenerationResult> {
    return this.#db.transaction().execute(async (trx) => {
      const admission = await readAdmission(trx, generation.rootId);
      if (admission.kind !== "admitted") {
        return admission;
      }

      const missingCount = await this.#applyGeneration(trx, generation);
      await trx
        .updateTable("media_roots")
        .set({ last_scanned_at: generation.scannedAt })
        .where("id", "=", generation.rootId)
        .execute();
      return { kind: "committed", missingCount };
    });
  }

  /**
   * Commits a retry's lookups under write authority, touching no item row
   * and no root scan time. The root is re-checked as a scan's commit does.
   * Corrections live in their own table, which this never writes.
   */
  async commitRetry(
    rootId: string,
    entries: readonly RetryEntry[],
  ): Promise<{ kind: "committed" } | RootRejection> {
    return runImmediateTransaction(this.#db, async (pinned) => {
      const admission = await readAdmission(pinned, rootId);
      if (admission.kind !== "admitted") return admission;
      const current = new Map(
        (
          await pinned
            .selectFrom("media_items")
            .leftJoin(
              "metadata_matches",
              "metadata_matches.media_item_id",
              "media_items.id",
            )
            .select([
              "media_items.id",
              "metadata_matches.state",
              "metadata_matches.looked_up_at as lookedUpAt",
            ])
            .where(
              "media_items.id",
              "in",
              jsonIdList(entries.map(({ id }) => id)),
            )
            .where("media_items.removed_at", "is", null)
            .execute()
        ).map(({ id, state, lookedUpAt }) => [
          id,
          state === null ? null : { state, lookedUpAt },
        ]),
      );
      await replaceMatchRows(
        pinned,
        entries.filter((entry) => isRetryWritable(entry, current)),
      );
      return { kind: "committed" as const };
    });
  }

  /**
   * Writes every candidate and reconciles unseen items; returns new missing
   * transitions. Each chunk is one statement preceded by one macrotask yield,
   * so the existing-row read and each chunk hold the event loop separately and
   * timers and socket I/O stay responsive while the transaction stays open.
   * IDs are drawn only for path keys not yet cataloged. A removed item whose
   * file is gone stays removed rather than becoming missing.
   */
  async #applyGeneration(
    trx: Transaction<DatabaseSchema>,
    { rootId, scannedAt, candidates, metadataMatches = [] }: CatalogGeneration,
  ): Promise<number> {
    const existing = await trx
      .selectFrom("media_items")
      .select(["id", "path_key", "status", "removed_at"])
      .where("media_root_id", "=", rootId)
      .execute();
    const existingByKey = new Map(
      existing.map((item) => [item.path_key, item]),
    );

    // A removed item found again returns as if newly discovered.
    const rediscoveredIds: string[] = [];
    const rows = candidates.map((candidate) => {
      const existingItem = existingByKey.get(candidate.pathKey);
      if (existingItem?.removed_at != null) {
        rediscoveredIds.push(existingItem.id);
      }
      const id = existingItem?.id ?? this.#createId();
      existingByKey.delete(candidate.pathKey);
      return toItemRow(id, rootId, scannedAt, candidate);
    });
    for (const chunk of parameterChunks(rows)) {
      await yieldToEventLoop();
      await upsertItems(trx, chunk);
    }
    await writeMetadataMatches(
      trx,
      new Map(rows.map((row) => [row.path_key, row.id])),
      metadataMatches,
      rediscoveredIds,
    );

    // Whatever remains was not discovered; metadata stays for history.
    const newlyMissing = [...existingByKey.values()]
      .filter((item) => item.status !== "missing" && item.removed_at === null)
      .map((item) => item.id);
    for (const chunk of parameterChunks(newlyMissing)) {
      await yieldToEventLoop();
      await trx
        .updateTable("media_items")
        .set({ status: "missing", updated_at: scannedAt })
        .where("id", "in", chunk)
        .execute();
    }
    return newlyMissing.length;
  }
}

/**
 * Re-reads a root inside the caller's transaction and admits it as a scan's
 * start does, so a root disabled, deleted, or removed during a job never
 * receives that job's commit; a removed root reads as not found.
 */
async function readAdmission(
  executor: Kysely<DatabaseSchema>,
  rootId: string,
): Promise<{ kind: "admitted" } | RootRejection> {
  const row = await executor
    .selectFrom("media_roots")
    .select("enabled")
    .where("id", "=", rootId)
    .where("removed_at", "is", null)
    .executeTakeFirst();
  return admitRoot(row && { enabled: fromSqliteBoolean(row.enabled) });
}

/**
 * True when a retry's lookup may land. The item must still be cataloged and
 * hold the decision the retry read before asking TMDB, so a delayed retry
 * cannot restore a removed item or overwrite a choice or rejection made
 * meanwhile. A failed lookup replaces only an unmatched or missing decision,
 * since a transient failure keeps earlier accepted facts.
 */
function isRetryWritable(
  { id, record, read }: RetryEntry,
  current: ReadonlyMap<string, DecisionRead>,
): boolean {
  const now = current.get(id);
  if (now === undefined) return false;
  if (now?.state !== read?.state || now?.lookedUpAt !== read?.lookedUpAt) {
    return false;
  }
  const failed = record.kind === "looked_up" && record.lookup.kind === "failed";
  return !failed || now === null || now.state === "unmatched";
}

// A first-time probe failure has no metadata to keep, so it is stored as null.
function toItemRow(
  id: string,
  rootId: string,
  scannedAt: number,
  candidate: CatalogCandidate,
): Insertable<MediaItemTable> {
  const probed = candidate.status === "available";
  return {
    id,
    media_root_id: rootId,
    path: candidate.path,
    path_key: candidate.pathKey,
    title: candidate.title,
    duration_ms: probed ? candidate.durationMs : null,
    has_audio: probed ? toSqliteBoolean(candidate.hasAudio) : null,
    has_video: probed ? toSqliteBoolean(candidate.hasVideo) : null,
    status: candidate.status,
    probe_error: probed ? null : candidate.probeError,
    created_at: scannedAt,
    updated_at: scannedAt,
    last_seen_at: scannedAt,
    last_probed_at: candidate.probedAt,
  };
}

/**
 * Inserts new items and updates rediscovered ones in one statement. A
 * rediscovered item keeps its `id` and `created_at`, and a later probe failure
 * keeps the last known metadata for diagnostics; status stays authoritative.
 * A removed item that is rediscovered before purge returns to the catalog,
 * with no collection memberships, as if newly discovered.
 */
async function upsertItems(
  trx: Transaction<DatabaseSchema>,
  rows: readonly Insertable<MediaItemTable>[],
): Promise<void> {
  await trx
    .insertInto("media_items")
    .values(rows)
    .onConflict((conflict) =>
      conflict.columns(["media_root_id", "path_key"]).doUpdateSet((eb) => {
        const probed = eb("excluded.status", "=", "available");
        return {
          path: eb.ref("excluded.path"),
          title: eb.ref("excluded.title"),
          duration_ms: eb
            .case()
            .when(probed)
            .then(eb.ref("excluded.duration_ms"))
            .else(eb.ref("media_items.duration_ms"))
            .end(),
          has_audio: eb
            .case()
            .when(probed)
            .then(eb.ref("excluded.has_audio"))
            .else(eb.ref("media_items.has_audio"))
            .end(),
          has_video: eb
            .case()
            .when(probed)
            .then(eb.ref("excluded.has_video"))
            .else(eb.ref("media_items.has_video"))
            .end(),
          status: eb.ref("excluded.status"),
          probe_error: eb.ref("excluded.probe_error"),
          updated_at: eb.ref("excluded.updated_at"),
          last_seen_at: eb.ref("excluded.last_seen_at"),
          last_probed_at: eb.ref("excluded.last_probed_at"),
          removed_at: null,
        };
      }),
    )
    .execute();
}
