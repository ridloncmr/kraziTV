import { randomUUID } from "node:crypto";

import type { Kysely, Selectable } from "kysely";

import type { DatabaseSchema, MediaRootTable } from "../database/schema.js";
import type { NormalizedMediaPath } from "@krazitv/media";

export interface MediaRoot {
  id: string;
  path: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastScannedAt: number | null;
}

export type CreateMediaRootResult =
  { kind: "created"; root: MediaRoot } | { kind: "duplicate" };

export interface MediaRootRepositoryOptions {
  createId?: () => string;
  now?: () => number;
}

/** Persists media roots and translates SQLite rows into typed domain records. */
export class MediaRootRepository {
  readonly #db: Kysely<DatabaseSchema>;
  readonly #createId: () => string;
  readonly #now: () => number;

  // Clock and ID sources are injectable so tests can assert exact timestamps and IDs.
  constructor(
    db: Kysely<DatabaseSchema>,
    options: MediaRootRepositoryOptions = {},
  ) {
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
          enabled: enabled ? 1 : 0,
          created_at: now,
          updated_at: now,
          last_scanned_at: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return { kind: "created", root: toMediaRoot(row) };
    } catch (error) {
      if (isDuplicatePathKey(error)) {
        return { kind: "duplicate" };
      }
      throw error;
    }
  }

  /** Lists every root in path-identity order, with ID as a stable tie-breaker. */
  async list(): Promise<MediaRoot[]> {
    const rows = await this.#db
      .selectFrom("media_roots")
      .selectAll()
      .orderBy("path_key")
      .orderBy("id")
      .execute();
    return rows.map(toMediaRoot);
  }

  /** Loads one root for operations such as scanning that act on a single root. */
  async findById(id: string): Promise<MediaRoot | undefined> {
    const row = await this.#db
      .selectFrom("media_roots")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return row === undefined ? undefined : toMediaRoot(row);
  }

  /** Toggles scan eligibility; returns undefined when the root does not exist. */
  async setEnabled(
    id: string,
    enabled: boolean,
  ): Promise<MediaRoot | undefined> {
    const row = await this.#db
      .updateTable("media_roots")
      .set({ enabled: enabled ? 1 : 0, updated_at: this.#now() })
      .where("id", "=", id)
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
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastScannedAt: row.last_scanned_at,
  };
}

// Distinguishes identity collisions from every other failure, which must propagate.
function isDuplicatePathKey(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "SQLITE_CONSTRAINT_UNIQUE" &&
    error.message.includes("media_roots.path_key")
  );
}
