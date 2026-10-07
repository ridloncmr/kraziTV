import { randomUUID } from "node:crypto";

import type { Kysely, Selectable } from "kysely";

import {
  fromSqliteBoolean,
  toSqliteBoolean,
} from "../database/columns/sqlite-boolean.js";
import type { DatabaseSchema } from "../database/schema/database-schema.js";
import type { MediaRootTable } from "../database/schema/media-root-table.js";
import type { RecordSources } from "../database/writes/record-sources.js";
import { isUniqueViolation } from "../database/writes/unique-violation.js";
import type { NormalizedMediaPath } from "@krazitv/media";
import type { CreateMediaRootResult, MediaRoot } from "./contracts.js";

/** Persists media roots and translates SQLite rows into typed domain records. */
export class MediaRootRepository {
  readonly #db: Kysely<DatabaseSchema>;
  readonly #createId: () => string;
  readonly #now: () => number;

  // Clock and ID sources are injectable so tests can assert exact timestamps and IDs.
  constructor(db: Kysely<DatabaseSchema>, options: RecordSources = {}) {
    this.#db = db;
    this.#createId = options.createId ?? randomUUID;
    this.#now = options.now ?? Date.now;
  }

  /** Inserts a root; the unique path_key constraint is the final duplicate guard. */
  async create(
    rootPath: NormalizedMediaPath,
    enabled: boolean,
  ): Promise<CreateMediaRootResult> {
    const now = this.#now();
    try {
      const row = await this.#db
        .insertInto("media_roots")
        .values({
          id: this.#createId(),
          path: rootPath.path,
          path_key: rootPath.pathKey,
          enabled: toSqliteBoolean(enabled),
          created_at: now,
          updated_at: now,
          last_scanned_at: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return { kind: "created", root: toMediaRoot(row) };
    } catch (error) {
      if (isUniqueViolation(error, "media_roots.path_key")) {
        return { kind: "duplicate" };
      }
      throw error;
    }
  }

  /** Lists every cataloged root in path-identity order, with ID as a stable tie-breaker. */
  async list(): Promise<MediaRoot[]> {
    const rows = await this.#db
      .selectFrom("media_roots")
      .selectAll()
      .where("removed_at", "is", null)
      .orderBy("path_key")
      .orderBy("id")
      .execute();
    return rows.map(toMediaRoot);
  }

  /**
   * Loads one root for operations such as scanning that act on a single
   * root. A removed root reads as unknown, so no such operation reaches it.
   */
  async findById(id: string): Promise<MediaRoot | undefined> {
    const row = await this.#db
      .selectFrom("media_roots")
      .selectAll()
      .where("id", "=", id)
      .where("removed_at", "is", null)
      .executeTakeFirst();
    return row === undefined ? undefined : toMediaRoot(row);
  }

  /** Toggles scan eligibility; returns undefined when the root does not exist or was removed. */
  async setEnabled(
    id: string,
    enabled: boolean,
  ): Promise<MediaRoot | undefined> {
    const row = await this.#db
      .updateTable("media_roots")
      .set({ enabled: toSqliteBoolean(enabled), updated_at: this.#now() })
      .where("id", "=", id)
      .where("removed_at", "is", null)
      .returningAll()
      .executeTakeFirst();
    return row === undefined ? undefined : toMediaRoot(row);
  }
}

// Keeps SQLite's integer booleans and internal identity key out of callers.
function toMediaRoot(row: Selectable<MediaRootTable>): MediaRoot {
  return {
    id: row.id,
    path: row.path,
    enabled: fromSqliteBoolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastScannedAt: row.last_scanned_at,
  };
}
