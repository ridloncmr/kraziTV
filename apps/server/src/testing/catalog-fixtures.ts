// Deterministic catalog rows for tests only; production code must never import this module.
import type { Insertable, Kysely } from "kysely";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import type { MediaCollectionItemTable } from "../database/schema/media-collection-item-table.js";
import type { MediaCollectionTable } from "../database/schema/media-collection-table.js";
import type { MediaItemTable } from "../database/schema/media-item-table.js";
import type { MediaRootTable } from "../database/schema/media-root-table.js";
import { parameterChunks } from "../database/writes/parameter-chunks.js";

export const FIXTURE_TIME = 1_704_067_200_000;

export const rootFixture: Insertable<MediaRootTable> = {
  id: "root-fixture-001",
  path: "/media/movies",
  path_key: "/media/movies",
  enabled: 1,
  created_at: FIXTURE_TIME,
  updated_at: FIXTURE_TIME,
  last_scanned_at: null,
  removed_at: null,
};

/** A second root whose path key sorts before rootFixture's even though its ID sorts after. */
export const animeRootFixture: Insertable<MediaRootTable> = {
  ...rootFixture,
  id: "root-fixture-002",
  path: "/media/anime",
  path_key: "/media/anime",
};

export const itemFixture: Insertable<MediaItemTable> = {
  id: "item-fixture-001",
  media_root_id: rootFixture.id,
  path: "/media/movies/example.mkv",
  path_key: "/media/movies/example.mkv",
  title: "Example",
  duration_ms: 7_200_000,
  has_audio: 1,
  has_video: 1,
  status: "available",
  probe_error: null,
  created_at: FIXTURE_TIME,
  updated_at: FIXTURE_TIME,
  last_seen_at: FIXTURE_TIME,
  last_probed_at: FIXTURE_TIME,
  removed_at: null,
};

/**
 * The item fixture at its own ID and path. The path key mirrors the path, so
 * tests that insert several items never collide on the unique path key.
 */
export function itemFixtureAt(
  id: string,
  path: string,
  overrides: Partial<Insertable<MediaItemTable>> = {},
): Insertable<MediaItemTable> {
  return { ...itemFixture, id, path, path_key: path, ...overrides };
}

/**
 * The item fixture under rootFixture whose ID doubles as its title and file
 * name, so a test can name each item once and read it back by that name.
 */
export function titledItemFixture(
  id: string,
  overrides: Partial<Insertable<MediaItemTable>> = {},
): Insertable<MediaItemTable> {
  return itemFixtureAt(id, `${rootFixture.path}/${id}.mkv`, {
    title: id,
    ...overrides,
  });
}

/**
 * Inserts a titled item per ID in one transaction. Bulk seeds then pay for one
 * commit instead of one fsync per chunk, which kept large-membership tests
 * near the timeout when the suite runs in parallel.
 */
export async function insertTitledItems(
  db: Kysely<DatabaseSchema>,
  ids: readonly string[],
): Promise<void> {
  const rows = ids.map((id) => titledItemFixture(id));
  await db.transaction().execute(async (trx) => {
    for (const chunk of parameterChunks(rows)) {
      await trx.insertInto("media_items").values(chunk).execute();
    }
  });
}

export const collectionFixture: Insertable<MediaCollectionTable> = {
  id: "collection-fixture-001",
  name: "Example Collection",
  created_at: FIXTURE_TIME,
  updated_at: FIXTURE_TIME,
};

export const collectionItemFixture: Insertable<MediaCollectionItemTable> = {
  media_collection_id: collectionFixture.id,
  media_item_id: itemFixture.id,
  position: 0,
  created_at: FIXTURE_TIME,
};
