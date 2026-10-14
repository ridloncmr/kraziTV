import type { Kysely, Selectable } from "kysely";

import {
  fromNullableSqliteBoolean,
  toSqliteBoolean,
} from "../../database/columns/sqlite-boolean.js";
import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import type { MediaCollectionTable } from "../../database/schema/media-collection-table.js";
import { parameterChunks } from "../../database/writes/parameter-chunks.js";
import type { CollectionCriterion, MediaCollection } from "../contracts.js";
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
