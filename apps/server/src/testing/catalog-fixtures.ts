// Deterministic catalog rows for tests only; production code must never import this module.
import type { Insertable } from "kysely";

import type { MediaCollectionItemTable } from "../database/schema/media-collection-item-table.js";
import type { MediaCollectionTable } from "../database/schema/media-collection-table.js";
import type { MediaItemTable } from "../database/schema/media-item-table.js";
import type { MediaRootTable } from "../database/schema/media-root-table.js";

export const FIXTURE_TIME = 1_704_067_200_000;

export const rootFixture: Insertable<MediaRootTable> = {
  id: "root-fixture-001",
  path: "/media/movies",
  path_key: "/media/movies",
  enabled: 1,
  created_at: FIXTURE_TIME,
  updated_at: FIXTURE_TIME,
  last_scanned_at: null,
};

export const itemFixture: Insertable<MediaItemTable> = {
  id: "item-fixture-001",
  media_root_id: rootFixture.id,
  path: "/media/movies/example.mkv",
  path_key: "/media/movies/example.mkv",
  title: "Example",
  duration_ms: 7_200_000,
  has_audio: 1,
  status: "available",
  probe_error: null,
  created_at: FIXTURE_TIME,
  updated_at: FIXTURE_TIME,
  last_seen_at: FIXTURE_TIME,
  last_probed_at: FIXTURE_TIME,
};

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
