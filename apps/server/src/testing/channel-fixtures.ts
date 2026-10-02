// Deterministic channel and programming rows for tests only; production code must never import this module.
import type { Insertable } from "kysely";

import { collectionFixture, FIXTURE_TIME } from "./catalog-fixtures.js";
import type { ChannelTable } from "../database/schema/channel-table.js";
import type { ProgrammingBlockTable } from "../database/schema/programming-block-table.js";

export const channelFixture: Insertable<ChannelTable> = {
  id: "channel-fixture-001",
  number: "69",
  name: "Example Channel",
  enabled: 1,
  created_at: FIXTURE_TIME,
  updated_at: FIXTURE_TIME,
};

/** A collection-sourced block; reference the catalog fixtures' collection before inserting it. */
export const programmingBlockFixture: Insertable<ProgrammingBlockTable> = {
  id: "block-fixture-001",
  channel_id: channelFixture.id,
  source_kind: "collection",
  media_collection_id: collectionFixture.id,
  media_item_id: null,
  playback_mode: "chronological",
  created_at: FIXTURE_TIME,
  updated_at: FIXTURE_TIME,
};
