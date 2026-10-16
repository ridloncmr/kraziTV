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
import type { ProgrammingAssignmentMemberTable } from "../database/schema/programming-assignment-member-table.js";
import type { ProgrammingBlockTable } from "../database/schema/programming-block-table.js";
import type { ProgrammingRuleSourceTable } from "../database/schema/programming-rule-source-table.js";
import type { ProgrammingRuleTable } from "../database/schema/programming-rule-table.js";
import type { ProgrammingSourceAssignmentTable } from "../database/schema/programming-source-assignment-table.js";
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
  programming_seed: 654_321,
  rebuild_count: 0,
  last_rebuild_key: null,
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
  // Hand-placed, so no generated block holds it.
  programming_block_id: null,
  media_collection_id: collectionFixture.id,
  playback_mode: "chronological",
  playback_index: 0,
  created_at: FIXTURE_TIME,
  updated_at: FIXTURE_TIME,
};

/**
 * The fixture channel's chronological progress through the fixture
 * collection, after the fixture entry selected the fixture item.
 */
export const collectionProgressFixture: Insertable<ChannelCollectionProgressTable> =
  {
    channel_id: channelFixture.id,
    media_collection_id: collectionFixture.id,
    playback_mode: "chronological",
    last_media_item_id: itemFixture.id,
    last_position: 0,
    next_selection_index: 0,
    reset_sequence_number: null,
    order_fingerprint: null,
    updated_at: FIXTURE_TIME,
  };

/** The fixture channel's one assignment: the fixture collection in saved order, three programs a turn. */
export const assignmentFixture: Insertable<ProgrammingSourceAssignmentTable> = {
  id: "assignment-fixture-001",
  channel_id: channelFixture.id,
  playback_mode: "chronological",
  participation: "default",
  assignment_order: 0,
  ordinary_kind: "programs",
  ordinary_min: 3,
  ordinary_max: null,
  marathon_kind: null,
  marathon_min: null,
  marathon_max: null,
  created_at: FIXTURE_TIME,
  updated_at: FIXTURE_TIME,
};

/** The fixture assignment's only member, the fixture collection; insert the catalog fixtures first. */
export const assignmentMemberFixture: Insertable<ProgrammingAssignmentMemberTable> =
  {
    assignment_id: assignmentFixture.id,
    channel_id: channelFixture.id,
    position: 0,
    source_kind: "collection",
    media_collection_id: collectionFixture.id,
    media_item_id: null,
    created_at: FIXTURE_TIME,
  };

/** A December join rule on the fixture channel, applying all day. */
export const ruleFixture: Insertable<ProgrammingRuleTable> = {
  id: "rule-fixture-001",
  channel_id: channelFixture.id,
  name: "December",
  behavior: "join",
  priority: 0,
  rule_order: 0,
  date_kind: "annual",
  start_date: null,
  end_date: null,
  start_month_day: "12-01",
  end_month_day: "12-31",
  weekdays: null,
  window_start_minute: null,
  window_end_minute: null,
  created_at: FIXTURE_TIME,
  updated_at: FIXTURE_TIME,
};

/** The fixture rule selecting the fixture assignment with its own settings; insert both first. */
export const ruleSourceFixture: Insertable<ProgrammingRuleSourceTable> = {
  rule_id: ruleFixture.id,
  channel_id: channelFixture.id,
  assignment_id: assignmentFixture.id,
  position: 0,
  ordinary_kind: null,
  ordinary_min: null,
  ordinary_max: null,
  marathon_mode: "inherit",
  marathon_kind: null,
  marathon_min: null,
  marathon_max: null,
  created_at: FIXTURE_TIME,
};

/**
 * A generated turn of the fixture collection whose assignment is gone, as
 * history, so it inserts beside the catalog fixtures alone. Set
 * `assignment_id` after inserting the assignment fixture to keep it live.
 */
export const programmingBlockFixture: Insertable<ProgrammingBlockTable> = {
  id: "block-fixture-001",
  channel_id: channelFixture.id,
  assignment_id: null,
  source_kind: "collection",
  media_collection_id: collectionFixture.id,
  media_item_id: null,
  playback_mode: "chronological",
  round_number: 1,
  turn_index: 0,
  starts_at: FIXTURE_TIME,
  resolved_kind: "programs",
  resolved_value: 3,
  marathon: 0,
  ended_by_edit: 0,
  winning_rule_id: null,
  context_key: "default",
  setting_origins: JSON.stringify({
    ordinary: "assignment",
    marathon: "assignment",
  }),
  checkpoint: JSON.stringify({
    activeContext: "default",
    contexts: {
      default: {
        roundNumber: 1,
        pending: [assignmentFixture.id],
        served: [],
        skipped: [],
        unservedRemoved: [],
        marathonOpportunity: null,
        roundCommittedProgram: false,
      },
    },
    lastAiredAssignmentId: null,
    nextMemberPositions: { [assignmentFixture.id]: 0 },
    ordinaryRoundsSinceMarathon: null,
    rebuildCount: 0,
  }),
  created_at: FIXTURE_TIME,
  updated_at: FIXTURE_TIME,
};
