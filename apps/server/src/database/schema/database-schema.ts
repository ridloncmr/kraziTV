import type { ChannelCollectionProgressTable } from "./channel-collection-progress-table.js";
import type { ChannelScheduleStateTable } from "./channel-schedule-state-table.js";
import type { ChannelTable } from "./channel-table.js";
import type { MediaCollectionItemTable } from "./media-collection-item-table.js";
import type { MediaCollectionTable } from "./media-collection-table.js";
import type { MediaItemTable } from "./media-item-table.js";
import type { MediaRootTable } from "./media-root-table.js";
import type { ProgrammingBlockTable } from "./programming-block-table.js";
import type { ScheduleEntryTable } from "./schedule-entry-table.js";

// Maps every table name to its row type so Kysely can type-check all queries.
export interface DatabaseSchema {
  media_roots: MediaRootTable;
  media_items: MediaItemTable;
  media_collections: MediaCollectionTable;
  media_collection_items: MediaCollectionItemTable;
  channels: ChannelTable;
  programming_blocks: ProgrammingBlockTable;
  channel_schedule_states: ChannelScheduleStateTable;
  schedule_entries: ScheduleEntryTable;
  channel_collection_progress: ChannelCollectionProgressTable;
}
