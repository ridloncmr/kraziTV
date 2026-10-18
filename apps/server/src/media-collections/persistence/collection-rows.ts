import type { Kysely, Selectable } from "kysely";

import {
  fromNullableSqliteBoolean,
  toSqliteBoolean,
} from "../../database/columns/sqlite-boolean.js";
import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import type { MediaCollectionTable } from "../../database/schema/media-collection-table.js";
import { parameterChunks } from "../../database/writes/parameter-chunks.js";
import type {
  CollectionCriterion,
  MediaCollection,
  MediaCollectionMember,
} from "../contracts.js";
import {
  criterionKey,
  readStoredCriterion,
} from "../criteria/collection-criterion.js";
import { labelCriteria } from "./criterion-labels.js";

type Executor = Kysely<DatabaseSchema>;

/**
 * Inserts a collection and its members in order inside the caller's
 * transaction: manual, or automatic with the criterion and maintenance
 * result its membership came from. Every creation path goes through here,
 * so a collection's mode, criterion, and diagnostics always start
 * consistent.
 */
export async function insertCollection(
  executor: Executor,
  values: {
    id: string;
    name: string;
    now: number;
    memberIds: readonly string[];
    automatic?: { criterion: CollectionCriterion; incomplete: boolean };
  },
): Promise<MediaCollection> {
  const { id, name, now, memberIds, automatic } = values;
  const row = await executor
    .insertInto("media_collections")
    .values({
      id,
      name,
      created_at: now,
      updated_at: now,
      ...(automatic === undefined
        ? {}
        : {
            maintenance_mode: "automatic" as const,
            criterion: criterionKey(automatic.criterion),
            maintained_at: now,
            maintenance_incomplete: toSqliteBoolean(automatic.incomplete),
          }),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await insertMembers(executor, row.id, memberIds, now);
  const [collection] = await toMediaCollections(executor, [row]);
  return collection;
}

/** Answers existence without loading the row. */
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

/** Joins each membership to its item summary in one query, ordered by position. */
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

/** Writes contiguous zero-based positions in request order. */
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

/**
 * Converts rows into the camel-cased records callers use, in row order,
 * naming every criterion with one labels read so a listing never reads per
 * collection.
 */
export async function toMediaCollections(
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
