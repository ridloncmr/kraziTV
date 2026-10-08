import { sql, type Kysely, type RawBuilder } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import { jsonIdList } from "../../database/writes/parameter-chunks.js";
import type { CatalogRemovalTarget } from "../contracts.js";
import { targetItemIds } from "../removal-target.js";

/**
 * Marks the target removed at `now`, a root together with its items, and
 * takes the items out of every
 * collection, leaving each affected collection's remaining members at
 * contiguous zero-based positions in their previous order. Opens no
 * transaction: removal is a schedule input change, so this runs inside the
 * change's transaction. Every statement is set-based, so the statement count
 * never grows with the number of items.
 */
export async function removeFromCatalog(
  trx: Kysely<DatabaseSchema>,
  target: CatalogRemovalTarget,
  now: number,
): Promise<void> {
  const items = targetItemIds(target);
  const collections = await trx
    .selectFrom("media_collection_items")
    .select("media_collection_id")
    .distinct()
    .where("media_item_id", "in", items)
    .execute();
  const collectionIds = jsonIdList(
    collections.map((row) => row.media_collection_id),
  );

  if ("mediaRootId" in target) {
    await trx
      .updateTable("media_roots")
      .set({ removed_at: now })
      .where("id", "=", target.mediaRootId)
      .execute();
  }
  await trx
    .updateTable("media_items")
    .set({ removed_at: now })
    .where("id", "in", items)
    .where("removed_at", "is", null)
    .execute();
  await trx
    .updateTable("media_collections")
    .set({ updated_at: now })
    .where("id", "in", collectionIds)
    .execute();
  await trx
    .deleteFrom("media_collection_items")
    .where("media_item_id", "in", items)
    .execute();
  await compactPositions(trx, collectionIds);
}

/**
 * Renumbers each listed collection's members 0..n-1 in position order.
 * SQLite checks the (collection, position) key row by row, so renumbering in
 * place could collide with a member not yet moved. Members first move past
 * every position in the table, where nothing can collide, then take their
 * ranks, all below where they now sit.
 */
async function compactPositions(
  trx: Kysely<DatabaseSchema>,
  collectionIds: RawBuilder<string>,
): Promise<void> {
  await sql`
    update media_collection_items
    set position = position + (select max(position) + 1 from media_collection_items)
    where media_collection_id in ${collectionIds}
  `.execute(trx);
  await sql`
    update media_collection_items
    set position = ranked.new_position
    from (
      select
        media_collection_id,
        media_item_id,
        row_number() over (
          partition by media_collection_id order by position
        ) - 1 as new_position
      from media_collection_items
      where media_collection_id in ${collectionIds}
    ) as ranked
    where media_collection_items.media_collection_id = ranked.media_collection_id
      and media_collection_items.media_item_id = ranked.media_item_id
  `.execute(trx);
}
