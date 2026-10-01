import { randomUUID } from "node:crypto";

import type { Kysely, Selectable, Transaction } from "kysely";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import type { MediaCollectionTable } from "../database/schema/media-collection-table.js";
import type {
  CreateMediaCollectionResult,
  MediaCollection,
  MediaCollectionMember,
  MediaCollectionRepositoryOptions,
  ReplaceMediaCollectionMembersResult,
} from "./contracts.js";

// Keeps every statement well under SQLite's 32,766 bound-parameter limit.
const CHUNK_SIZE = 1_000;

// Fixed locale so list order never depends on the host's locale settings.
const NAME_COLLATOR = new Intl.Collator("en", { sensitivity: "base" });

type Executor = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;

/**
 * Persists media collections and their explicit item order. Duplicate member
 * IDs are a caller error: the unique constraint throws and the write rolls back.
 */
export class MediaCollectionRepository {
  readonly #db: Kysely<DatabaseSchema>;
  readonly #createId: () => string;
  readonly #now: () => number;

  // Clock and ID sources are injectable so tests can assert exact timestamps and IDs.
  constructor(
    db: Kysely<DatabaseSchema>,
    options: MediaCollectionRepositoryOptions = {},
  ) {
    this.#db = db;
    this.#createId = options.createId ?? randomUUID;
    this.#now = options.now ?? Date.now;
  }

  /** Creates a collection and its ordered members atomically, or nothing if any item is unknown. */
  async create(
    name: string,
    mediaItemIds: readonly string[] = [],
  ): Promise<CreateMediaCollectionResult> {
    return this.#db.transaction().execute(async (trx) => {
      const unknown = await findUnknownMediaItemIds(trx, mediaItemIds);
      if (unknown.length > 0) {
        return { kind: "unknown_media_items", mediaItemIds: unknown };
      }

      const now = this.#now();
      const row = await trx
        .insertInto("media_collections")
        .values({
          id: this.#createId(),
          name,
          created_at: now,
          updated_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await insertMembers(trx, row.id, mediaItemIds, now);
      return { kind: "created", collection: toMediaCollection(row) };
    });
  }

  /** Lists every collection by case-folded name, with ID as a stable tie-breaker. */
  async list(): Promise<MediaCollection[]> {
    const rows = await this.#db
      .selectFrom("media_collections")
      .selectAll()
      .execute();
    return rows
      .map(toMediaCollection)
      .sort(
        (a, b) =>
          NAME_COLLATOR.compare(a.name, b.name) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
  }

  /** Loads one collection; returns undefined when the ID is unknown. */
  async findById(id: string): Promise<MediaCollection | undefined> {
    const row = await this.#db
      .selectFrom("media_collections")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return row === undefined ? undefined : toMediaCollection(row);
  }

  /** Renames a collection; returns undefined when it does not exist. */
  async rename(id: string, name: string): Promise<MediaCollection | undefined> {
    const row = await this.#db
      .updateTable("media_collections")
      .set({ name, updated_at: this.#now() })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
    return row === undefined ? undefined : toMediaCollection(row);
  }

  /** Deletes a collection; its membership cascades and its media items remain. */
  async delete(id: string): Promise<boolean> {
    const result = await this.#db
      .deleteFrom("media_collections")
      .where("id", "=", id)
      .executeTakeFirst();
    return result.numDeletedRows > 0n;
  }

  /** Lists members in position order; undefined distinguishes an unknown collection from an empty one. */
  async listMembers(id: string): Promise<MediaCollectionMember[] | undefined> {
    return this.#db
      .transaction()
      .execute(async (trx) =>
        (await collectionExists(trx, id)) ? selectMembers(trx, id) : undefined,
      );
  }

  /**
   * Replaces the full membership in request order. Item existence is checked
   * inside the same transaction so a concurrent change cannot leave a dangling
   * member; the foreign key remains the final guard.
   */
  async replaceMembers(
    id: string,
    mediaItemIds: readonly string[],
  ): Promise<ReplaceMediaCollectionMembersResult> {
    return this.#db.transaction().execute(async (trx) => {
      if (!(await collectionExists(trx, id))) {
        return { kind: "not_found" };
      }

      const unknown = await findUnknownMediaItemIds(trx, mediaItemIds);
      if (unknown.length > 0) {
        return { kind: "unknown_media_items", mediaItemIds: unknown };
      }

      const now = this.#now();
      await trx
        .updateTable("media_collections")
        .set({ updated_at: now })
        .where("id", "=", id)
        .execute();
      await trx
        .deleteFrom("media_collection_items")
        .where("media_collection_id", "=", id)
        .execute();
      await insertMembers(trx, id, mediaItemIds, now);
      return { kind: "replaced", members: await selectMembers(trx, id) };
    });
  }
}

// Answers existence without loading the row.
async function collectionExists(
  executor: Executor,
  id: string,
): Promise<boolean> {
  const row = await executor
    .selectFrom("media_collections")
    .select("id")
    .where("id", "=", id)
    .executeTakeFirst();
  return row !== undefined;
}

// Returns requested IDs absent from the catalog, in request order without repeats.
async function findUnknownMediaItemIds(
  executor: Executor,
  mediaItemIds: readonly string[],
): Promise<string[]> {
  const requested = [...new Set(mediaItemIds)];
  const known = new Set<string>();
  for (const chunk of chunks(requested)) {
    const rows = await executor
      .selectFrom("media_items")
      .select("id")
      .where("id", "in", chunk)
      .execute();
    for (const { id } of rows) known.add(id);
  }
  return requested.filter((id) => !known.has(id));
}

// Writes contiguous zero-based positions in request order.
async function insertMembers(
  executor: Executor,
  mediaCollectionId: string,
  mediaItemIds: readonly string[],
  now: number,
): Promise<void> {
  const rows = mediaItemIds.map((mediaItemId, position) => ({
    media_collection_id: mediaCollectionId,
    media_item_id: mediaItemId,
    position,
    created_at: now,
  }));
  for (const chunk of chunks(rows)) {
    await executor.insertInto("media_collection_items").values(chunk).execute();
  }
}

// Joins each membership to its item summary in one query, ordered by position.
async function selectMembers(
  executor: Executor,
  mediaCollectionId: string,
): Promise<MediaCollectionMember[]> {
  const rows = await executor
    .selectFrom("media_collection_items")
    .innerJoin(
      "media_items",
      "media_items.id",
      "media_collection_items.media_item_id",
    )
    .select([
      "media_collection_items.position",
      "media_items.id",
      "media_items.title",
      "media_items.status",
      "media_items.duration_ms",
    ])
    .where("media_collection_items.media_collection_id", "=", mediaCollectionId)
    .orderBy("media_collection_items.position")
    .execute();
  return rows.map((row) => ({
    position: row.position,
    mediaItemId: row.id,
    title: row.title,
    status: row.status,
    durationMs: row.duration_ms,
  }));
}

// Splits a list so each statement stays within SQLite's parameter limit.
function chunks<T>(values: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < values.length; start += CHUNK_SIZE) {
    result.push(values.slice(start, start + CHUNK_SIZE));
  }
  return result;
}

// Converts a row into the camel-cased record callers use.
function toMediaCollection(
  row: Selectable<MediaCollectionTable>,
): MediaCollection {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
