import { randomUUID } from "node:crypto";

import { sql, type Kysely, type Selectable } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import type { MediaCollectionTable } from "../../database/schema/media-collection-table.js";
import {
  fromNullableSqliteBoolean,
  toSqliteBoolean,
} from "../../database/columns/sqlite-boolean.js";
import { runImmediateTransaction } from "../../database/writes/immediate-transaction.js";
import { parameterChunks } from "../../database/writes/parameter-chunks.js";
import type { RecordSources } from "../../database/writes/record-sources.js";
import { findUnknownMediaItemIds } from "../../media-items/media-item-repository.js";
import { listCatalogGroups } from "../criteria/catalog-groups.js";
import {
  criterionKey,
  readStoredCriterion,
} from "../criteria/collection-criterion.js";
import { matchMembership } from "../criteria/match-criterion.js";
import { readMatchableItems } from "../criteria/matchable-items.js";
import { compareNames } from "../name-order.js";
import { findChannelsUsingCollection } from "./channels-using-collection.js";
import { labelCriteria } from "./criterion-labels.js";
import {
  readExcludedIds,
  readExcludedItems,
} from "../exclusions/excluded-items.js";
import type {
  CatalogGroup,
  CollectionCriterion,
  CreateMediaCollectionResult,
  DeleteMediaCollectionResult,
  ExcludedItem,
  MediaCollection,
  MediaCollectionMember,
  MediaCollectionSummary,
} from "../contracts.js";

type Executor = Kysely<DatabaseSchema>;

/**
 * Persists media collections and their explicit item order. Duplicate member
 * IDs are a caller error: the unique constraint throws and the write rolls back.
 */
export class MediaCollectionRepository {
  readonly #db: Kysely<DatabaseSchema>;
  readonly #createId: () => string;
  readonly #now: () => number;

  // Clock and ID sources are injectable so tests can assert exact timestamps and IDs.
  constructor(db: Kysely<DatabaseSchema>, options: RecordSources = {}) {
    this.#db = db;
    this.#createId = options.createId ?? randomUUID;
    this.#now = options.now ?? Date.now;
  }

  /** Creates a manual collection and its ordered members atomically, or nothing if any item is unknown. */
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
      const [collection] = await toMediaCollections(trx, [row]);
      return { kind: "created", collection };
    });
  }

  /**
   * Creates an automatic collection holding what its criterion matches now.
   * Matching and the insert share one immediate transaction, so the
   * membership comes from the facts committed when the collection appears
   * and no fact write can land between the two. A new collection feeds no
   * programming block yet, so no schedule changes with it.
   */
  async createAutomatic(
    name: string,
    criterion: CollectionCriterion,
  ): Promise<MediaCollection> {
    return runImmediateTransaction(this.#db, async (pinned) => {
      const { members, incomplete } = matchMembership(
        criterion,
        await readMatchableItems(pinned),
        [],
        [],
      );
      const now = this.#now();
      const row = await pinned
        .insertInto("media_collections")
        .values({
          id: this.#createId(),
          name,
          created_at: now,
          updated_at: now,
          maintenance_mode: "automatic",
          criterion: criterionKey(criterion),
          maintained_at: now,
          maintenance_incomplete: toSqliteBoolean(incomplete),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await insertMembers(
        pinned,
        row.id,
        members.map((member) => member.id),
        now,
      );
      const [collection] = await toMediaCollections(pinned, [row]);
      return collection;
    });
  }

  /**
   * Returns the ordered members a criterion would give a collection now,
   * writing nothing. Given a collection, its exclusions apply, so the
   * preview equals what changing that collection's criterion applies;
   * undefined when that collection is unknown.
   */
  async previewCriterion(
    criterion: CollectionCriterion,
    mediaCollectionId?: string,
  ): Promise<MediaCollectionMember[] | undefined> {
    if (
      mediaCollectionId !== undefined &&
      !(await collectionExists(this.#db, mediaCollectionId))
    ) {
      return undefined;
    }
    const { members } = matchMembership(
      criterion,
      await readMatchableItems(this.#db),
      [],
      mediaCollectionId === undefined
        ? []
        : await readExcludedIds(this.#db, mediaCollectionId),
    );
    return members.map((item, position) => ({
      position,
      mediaItemId: item.id,
      title: item.title,
      path: item.path,
      status: item.status,
      durationMs: item.durationMs,
    }));
  }

  /** Lists the TMDB series or franchises cataloged items belong to, for choosing a criterion of `kind`. */
  async listCatalogGroups(
    kind: CollectionCriterion["kind"],
  ): Promise<CatalogGroup[]> {
    return listCatalogGroups(kind, await readMatchableItems(this.#db));
  }

  /**
   * Lists every collection with its member and missing-member counts, by
   * case-folded name with ID as a stable tie-breaker. One grouped query, so
   * the counts never need a read per collection.
   */
  async list(): Promise<MediaCollectionSummary[]> {
    const rows = await this.#db
      .selectFrom("media_collections")
      .leftJoin(
        "media_collection_items",
        "media_collection_items.media_collection_id",
        "media_collections.id",
      )
      .leftJoin(
        "media_items",
        "media_items.id",
        "media_collection_items.media_item_id",
      )
      .selectAll("media_collections")
      .select((eb) => [
        eb.fn
          .count<number>("media_collection_items.media_item_id")
          .as("member_count"),
        sql<number>`count(case when ${eb.ref("media_items.status")} = 'missing' then 1 end)`.as(
          "missing_count",
        ),
      ])
      .groupBy("media_collections.id")
      .execute();
    const collections = await toMediaCollections(this.#db, rows);
    return rows
      .map((row, index) => ({
        ...collections[index],
        memberCount: row.member_count,
        missingCount: row.missing_count,
      }))
      .sort(compareNames);
  }

  /** Loads one collection; returns undefined when the ID is unknown. */
  async findById(id: string): Promise<MediaCollection | undefined> {
    const row = await this.#db
      .selectFrom("media_collections")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return row === undefined
      ? undefined
      : (await toMediaCollections(this.#db, [row]))[0];
  }

  /** Renames a collection, leaving any criterion alone; returns undefined when it does not exist. */
  async rename(id: string, name: string): Promise<MediaCollection | undefined> {
    const row = await this.#db
      .updateTable("media_collections")
      .set({ name, updated_at: this.#now() })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
    return row === undefined
      ? undefined
      : (await toMediaCollections(this.#db, [row]))[0];
  }

  /**
   * Turns a collection manual, keeping its members and their order: its
   * criterion, exclusions, and maintenance diagnostics go, so maintenance
   * never reads it again. Membership is unchanged, so no schedule changes.
   * Read and written under write authority, so a pass that commits first
   * has already finished with it and one that commits later skips it.
   * Converting a manual collection changes nothing.
   */
  async convertToManual(id: string): Promise<MediaCollection | undefined> {
    return runImmediateTransaction(this.#db, async (pinned) => {
      const row = await pinned
        .updateTable("media_collections")
        .set({
          maintenance_mode: "manual",
          criterion: null,
          maintained_at: null,
          maintenance_error: null,
          maintenance_incomplete: null,
        })
        .where("id", "=", id)
        .returningAll()
        .executeTakeFirst();
      if (row === undefined) return undefined;
      await pinned
        .deleteFrom("media_collection_exclusions")
        .where("media_collection_id", "=", id)
        .execute();
      const [collection] = await toMediaCollections(pinned, [row]);
      return collection;
    });
  }

  /**
   * Deletes a collection no programming block uses; its membership cascades
   * and its media items remain. The block check shares the delete's
   * transaction, so its snapshot is the one the delete writes against. If
   * another connection commits a block in between, SQLite refuses the stale
   * write with `SQLITE_BUSY`, which propagates; the foreign key still
   * guarantees no block is ever left dangling.
   */
  async delete(id: string): Promise<DeleteMediaCollectionResult> {
    return this.#db.transaction().execute(async (trx) => {
      if (!(await collectionExists(trx, id))) {
        return { kind: "not_found" };
      }
      const channelIds = await findChannelsUsingCollection(trx, id);
      if (channelIds.length > 0) {
        return { kind: "in_use", channelIds };
      }
      await trx.deleteFrom("media_collections").where("id", "=", id).execute();
      return { kind: "deleted" };
    });
  }

  /** Lists a collection's excluded items; undefined for an unknown collection. */
  async listExclusions(id: string): Promise<ExcludedItem[] | undefined> {
    return readExcludedItems(this.#db, id);
  }

  /** Lists members in position order; undefined distinguishes an unknown collection from an empty one. */
  async listMembers(id: string): Promise<MediaCollectionMember[] | undefined> {
    return this.#db
      .transaction()
      .execute(async (trx) =>
        (await collectionExists(trx, id)) ? selectMembers(trx, id) : undefined,
      );
  }
}

// Answers existence without loading the row.
export async function collectionExists(
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

// Writes contiguous zero-based positions in request order.
export async function insertMembers(
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
  for (const chunk of parameterChunks(rows)) {
    await executor.insertInto("media_collection_items").values(chunk).execute();
  }
}

// Joins each membership to its item summary in one query, ordered by position.
export async function selectMembers(
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
      "media_items.path",
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
    path: row.path,
    status: row.status,
    durationMs: row.duration_ms,
  }));
}

/**
 * Converts rows into the camel-cased records callers use, in row order,
 * naming every criterion with one labels read so a listing never reads per
 * collection.
 */
async function toMediaCollections(
  executor: Executor,
  rows: readonly Selectable<MediaCollectionTable>[],
): Promise<MediaCollection[]> {
  const criteria = rows.map((row) =>
    row.criterion === null
      ? null
      : (readStoredCriterion(row.criterion) ?? null),
  );
  const labels = await labelCriteria(
    executor,
    criteria.filter((criterion) => criterion !== null),
  );
  return rows.map((row, index) => {
    const criterion = criteria[index] ?? null;
    return {
      id: row.id,
      name: row.name,
      maintenanceMode: row.maintenance_mode,
      criterion,
      criterionLabel:
        criterion === null
          ? null
          : (labels.get(criterionKey(criterion)) ?? null),
      maintainedAt: row.maintained_at,
      maintenanceError: row.maintenance_error,
      maintenanceIncomplete: fromNullableSqliteBoolean(
        row.maintenance_incomplete,
      ),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}
