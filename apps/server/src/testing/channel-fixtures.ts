// Deterministic channel and programming rows for tests only; production code must never import this module.
import type { Insertable } from "kysely";

import {
  collectionFixture,
  FIXTURE_TIME,
  itemFixture,
} from "./catalog-fixtures.js";
import {
  parseChannelNumber,
  type ChannelNumber,
} from "../channels/channel-number.js";
import type { ChannelCollectionProgressTable } from "../database/schema/channel-collection-progress-table.js";
import type { ChannelScheduleStateTable } from "../database/schema/channel-schedule-state-table.js";
import type { ChannelTable } from "../database/schema/channel-table.js";
import type { ProgrammingBlockTable } from "../database/schema/programming-block-table.js";
import type { ScheduleEntryTable } from "../database/schema/schedule-entry-table.js";

/** Parses a test input that must be canonical, failing loudly on a typo. */
export function canonicalChannelNumber(input: string): ChannelNumber {
  const parsed = parseChannelNumber(input);
  if (parsed === undefined) {
    throw new Error(`Test input ${JSON.stringify(input)} is not canonical`);
  }
  return parsed;
}

export const channelFixture: Insertable<ChannelTable> = {
  id: "channel-fixture-001",
  number: "69",
  name: "Example Channel",
  enabled: 1,
  created_at: FIXTURE_TIME,
  updated_at: FIXTURE_TIME,
};

/** Schedule state for the fixture channel with one generated hour. */
export const scheduleStateFixture: Insertable<ChannelScheduleStateTable> = {
  channel_id: channelFixture.id,
  seed: 123_456,
  anchor_time: FIXTURE_TIME,
  last_generated_through: FIXTURE_TIME + 3_600_000,
  next_sequence_number: 1,
  schedule_revision: 1,
  created_at: FIXTURE_TIME,
  updated_at: FIXTURE_TIME,
};

/** The fixture channel's first entry, drawn chronologically from the fixture collection. */
export const scheduleEntryFixture: Insertable<ScheduleEntryTable> = {
  id: "entry-fixture-001",
  channel_id: channelFixture.id,
  media_item_id: itemFixture.id,
  title: "Example",
  starts_at: FIXTURE_TIME,
  ends_at: FIXTURE_TIME + 3_600_000,
  duration_ms: 3_600_000,
  sequence_number: 0,
  programming_block_id: "block-fixture-001",
  media_collection_id: collectionFixture.id,
  playback_mode: "chronological",
  playback_index: 0,
  created_at: FIXTURE_TIME,
  updated_at: FIXTURE_TIME,
};

/** The fixture channel's progress through the fixture collection. */
export const collectionProgressFixture: Insertable<ChannelCollectionProgressTable> =
  {
    channel_id: channelFixture.id,
    media_collection_id: collectionFixture.id,
    next_chronological_position: 1,
    next_random_selection_index: 0,
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
