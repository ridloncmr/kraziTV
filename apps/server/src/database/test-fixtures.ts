// Deterministic catalog rows for tests only; production code must never import this module.
import type { Insertable } from "kysely";

import type { MediaItemTable, MediaRootTable } from "./schema.js";

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
