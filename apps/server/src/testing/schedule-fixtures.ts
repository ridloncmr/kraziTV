// Seeds schedulable channels for tests only; production code must never import this module.
import type { Kysely } from "kysely";

import {
  collectionFixture,
  itemFixture,
  rootFixture,
} from "./catalog-fixtures.js";
import { channelFixture, programmingBlockFixture } from "./channel-fixtures.js";
import type { DatabaseSchema } from "../database/schema/database-schema.js";
import type { MediaItemTable } from "../database/schema/media-item-table.js";
import type { PlaybackMode } from "../database/schema/programming-block-table.js";

export interface ScheduleItemSpec {
  durationMs: number | null;
  status?: MediaItemTable["status"];
}

export interface ScheduleScenarioOptions {
  /** The collection's members, in membership order. */
  items: readonly ScheduleItemSpec[];
  /** What the channel's block plays: the collection in a mode, its first item, or no block. */
  source: PlaybackMode | "media_item" | null;
  enabled?: boolean;
}

export interface ScheduleScenario {
  channelId: string;
  collectionId: string;
  itemIds: string[];
}

/**
 * Inserts one channel, one collection of the given items, and a block over
 * them, so a schedule test states only the durations and source it cares about.
 */
export async function seedScheduleScenario(
  db: Kysely<DatabaseSchema>,
  options: ScheduleScenarioOptions,
): Promise<ScheduleScenario> {
  const channelId = channelFixture.id;
  const collectionId = collectionFixture.id;
  const itemIds = options.items.map(
    (_, index) => `item-${String(index + 1).padStart(3, "0")}`,
  );

  await db
    .insertInto("channels")
    .values({ ...channelFixture, enabled: options.enabled === false ? 0 : 1 })
    .execute();
  await db.insertInto("media_roots").values(rootFixture).execute();
  await db.insertInto("media_collections").values(collectionFixture).execute();
  if (options.items.length > 0) {
    await db
      .insertInto("media_items")
      .values(
        options.items.map((item, index) => ({
          ...itemFixture,
          id: itemIds[index],
          path: `/media/movies/${itemIds[index]}.mkv`,
          path_key: `/media/movies/${itemIds[index]}.mkv`,
          title: `Item ${index + 1}`,
          duration_ms: item.durationMs,
          status: item.status ?? "available",
        })),
      )
      .execute();
    await db
      .insertInto("media_collection_items")
      .values(
        itemIds.map((mediaItemId, position) => ({
          media_collection_id: collectionId,
          media_item_id: mediaItemId,
          position,
          created_at: itemFixture.created_at,
        })),
      )
      .execute();
  }

  if (options.source === "media_item") {
    await db
      .insertInto("programming_blocks")
      .values({
        ...programmingBlockFixture,
        source_kind: "media_item",
        media_collection_id: null,
        media_item_id: itemIds[0],
        playback_mode: null,
      })
      .execute();
  } else if (options.source !== null) {
    await db
      .insertInto("programming_blocks")
      .values({ ...programmingBlockFixture, playback_mode: options.source })
      .execute();
  }

  return { channelId, collectionId, itemIds };
}
