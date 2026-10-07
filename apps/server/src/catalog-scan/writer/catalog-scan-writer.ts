import { randomUUID } from "node:crypto";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";

import type { Insertable, Kysely, Transaction } from "kysely";

import {
  fromSqliteBoolean,
  toSqliteBoolean,
} from "../../database/columns/sqlite-boolean.js";
import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import type { MediaItemTable } from "../../database/schema/media-item-table.js";
import { parameterChunks } from "../../database/writes/parameter-chunks.js";
import type { RecordSources } from "../../database/writes/record-sources.js";
import type { CatalogCandidate, RootRejection } from "../contracts.js";
import { admitRoot } from "../root-admission.js";

/** A fully staged scan of one root, ready to replace that root's catalog state. */
interface CatalogGeneration {
  rootId: string;
  /** Final scan timestamp: `lastSeenAt` for every item and the root's `lastScannedAt`. */
  scannedAt: number;
  /** Every discovered file, in path-identity order. */
  candidates: readonly CatalogCandidate[];
}

type CommitGenerationResult =
  { kind: "committed"; missingCount: number } | RootRejection;

/**
 * The only scan component with database access. It applies a whole staged
 * generation in one transaction so a scan either replaces the root's catalog
 * state completely or leaves the previous state untouched.
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
   * Upserts candidates, marks unseen items missing, and records the scan time.
   * The root is re-read inside the transaction so a root disabled or deleted
   * during the scan can never receive a late generation.
   */
  async commit(generation: CatalogGeneration): Promise<CommitGenerationResult> {
    return this.#db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom("media_roots")
        .select("enabled")
        .where("id", "=", generation.rootId)
        .executeTakeFirst();
      const admission = admitRoot(
        row && { enabled: fromSqliteBoolean(row.enabled) },
      );
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
   * Writes every candidate and reconciles unseen items; returns new missing
   * transitions. Each chunk is one statement preceded by one macrotask yield,
   * so the existing-row read and each chunk hold the event loop separately and
   * timers and socket I/O stay responsive while the transaction stays open.
   * IDs are drawn only for path keys not yet cataloged.
   */
  async #applyGeneration(
    trx: Transaction<DatabaseSchema>,
    { rootId, scannedAt, candidates }: CatalogGeneration,
  ): Promise<number> {
    const existing = await trx
      .selectFrom("media_items")
      .select(["id", "path_key", "status"])
      .where("media_root_id", "=", rootId)
      .execute();
    const existingByKey = new Map(
      existing.map((item) => [item.path_key, item]),
    );

    const rows = candidates.map((candidate) => {
      const id = existingByKey.get(candidate.pathKey)?.id ?? this.#createId();
      existingByKey.delete(candidate.pathKey);
      return toItemRow(id, rootId, scannedAt, candidate);
    });
    for (const chunk of parameterChunks(rows)) {
      await yieldToEventLoop();
      await upsertItems(trx, chunk);
    }

    // Whatever remains was not discovered; metadata stays for history.
    const newlyMissing = [...existingByKey.values()]
      .filter((item) => item.status !== "missing")
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
        };
      }),
    )
    .execute();
}
