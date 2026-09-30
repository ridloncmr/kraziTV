import { randomUUID } from "node:crypto";

import type { Kysely, Transaction } from "kysely";

import type { DatabaseSchema } from "../database/schema.js";
import type { CatalogCandidate } from "./catalog-candidate.js";

/** A fully staged scan of one root, ready to replace that root's catalog state. */
export interface CatalogGeneration {
  rootId: string;
  /** Final scan timestamp: `lastSeenAt` for every item and the root's `lastScannedAt`. */
  scannedAt: number;
  /** Every discovered file, in path-identity order. */
  candidates: readonly CatalogCandidate[];
}

export type CommitGenerationResult =
  | { kind: "committed"; missingCount: number }
  | { kind: "root_not_found" }
  | { kind: "root_disabled" }
  | { kind: "cancelled" };

export interface CatalogScanWriterOptions {
  createId?: () => string;
}

/**
 * The only scan component with database access. It applies a whole staged
 * generation in one short transaction so a scan either replaces the root's
 * catalog state completely or leaves the previous state untouched.
 */
export class CatalogScanWriter {
  readonly #db: Kysely<DatabaseSchema>;
  readonly #createId: () => string;

  // The ID source is injectable so tests can assert exact inserted rows.
  constructor(
    db: Kysely<DatabaseSchema>,
    options: CatalogScanWriterOptions = {},
  ) {
    this.#db = db;
    this.#createId = options.createId ?? randomUUID;
  }

  /**
   * Upserts candidates, marks unseen items missing, and records the scan time.
   * The root is re-read inside the transaction so a root disabled or deleted
   * during the scan can never receive a late generation.
   */
  async commit(
    generation: CatalogGeneration,
    signal?: AbortSignal,
  ): Promise<CommitGenerationResult> {
    if (signal?.aborted) {
      return { kind: "cancelled" };
    }

    return this.#db.transaction().execute(async (trx) => {
      const root = await trx
        .selectFrom("media_roots")
        .select("enabled")
        .where("id", "=", generation.rootId)
        .executeTakeFirst();
      if (root === undefined) {
        return { kind: "root_not_found" };
      }
      if (root.enabled !== 1) {
        return { kind: "root_disabled" };
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

  // Writes every candidate and reconciles unseen items; returns new missing transitions.
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

    for (const candidate of candidates) {
      const current = existingByKey.get(candidate.pathKey);
      existingByKey.delete(candidate.pathKey);
      if (current === undefined) {
        await this.#insert(trx, rootId, scannedAt, candidate);
      } else {
        await update(trx, current.id, scannedAt, candidate);
      }
    }

    // Whatever remains was not discovered; metadata stays for history.
    const newlyMissing = [...existingByKey.values()]
      .filter((item) => item.status !== "missing")
      .map((item) => item.id);
    if (newlyMissing.length > 0) {
      await trx
        .updateTable("media_items")
        .set({ status: "missing", updated_at: scannedAt })
        .where("id", "in", newlyMissing)
        .execute();
    }
    return newlyMissing.length;
  }

  // A first-time probe failure has no metadata to keep, so it is stored as null.
  async #insert(
    trx: Transaction<DatabaseSchema>,
    rootId: string,
    scannedAt: number,
    candidate: CatalogCandidate,
  ): Promise<void> {
    const probed = candidate.status === "available";
    await trx
      .insertInto("media_items")
      .values({
        id: this.#createId(),
        media_root_id: rootId,
        path: candidate.path,
        path_key: candidate.pathKey,
        title: candidate.title,
        duration_ms: probed ? candidate.durationMs : null,
        has_audio: probed ? toSqliteBoolean(candidate.hasAudio) : null,
        status: candidate.status,
        probe_error: probed ? null : candidate.probeError,
        created_at: scannedAt,
        updated_at: scannedAt,
        last_seen_at: scannedAt,
        last_probed_at: candidate.probedAt,
      })
      .execute();
  }
}

// A later failure keeps the last known metadata for diagnostics; status stays authoritative.
async function update(
  trx: Transaction<DatabaseSchema>,
  id: string,
  scannedAt: number,
  candidate: CatalogCandidate,
): Promise<void> {
  const metadata =
    candidate.status === "available"
      ? {
          duration_ms: candidate.durationMs,
          has_audio: toSqliteBoolean(candidate.hasAudio),
          probe_error: null,
        }
      : { probe_error: candidate.probeError };

  await trx
    .updateTable("media_items")
    .set({
      ...metadata,
      path: candidate.path,
      title: candidate.title,
      status: candidate.status,
      updated_at: scannedAt,
      last_seen_at: scannedAt,
      last_probed_at: candidate.probedAt,
    })
    .where("id", "=", id)
    .execute();
}

// SQLite stores booleans as 0/1 under the schema's check constraints.
function toSqliteBoolean(value: boolean): number {
  return value ? 1 : 0;
}
