import type { AccountTable } from "./account-table.js";
import type { ChannelCollectionProgressTable } from "./channel-collection-progress-table.js";
import type { ChannelScheduleStateTable } from "./channel-schedule-state-table.js";
import type { ChannelTable } from "./channel-table.js";
import type { ContentFactsTable } from "./content-facts-table.js";
import type { MetadataCorrectionTable } from "./metadata-correction-table.js";
import type { MetadataMatchCandidateTable } from "./metadata-match-candidate-table.js";
import type { MetadataMatchTable } from "./metadata-match-table.js";
import type { MetadataProviderRefTable } from "./metadata-provider-ref-table.js";
import type { MediaCollectionItemTable } from "./media-collection-item-table.js";
import type { MediaCollectionTable } from "./media-collection-table.js";
import type { MediaItemTable } from "./media-item-table.js";
import type { MediaRootTable } from "./media-root-table.js";
import type { ProgrammingBlockTable } from "./programming-block-table.js";
import type { ScheduleEntryTable } from "./schedule-entry-table.js";
import type { ServerSettingsTable } from "./server-settings-table.js";
import type { SessionTable } from "./session-table.js";

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
  accounts: AccountTable;
  sessions: SessionTable;
  server_settings: ServerSettingsTable;
  metadata_matches: MetadataMatchTable;
  content_facts: ContentFactsTable;
  metadata_provider_refs: MetadataProviderRefTable;
  metadata_match_candidates: MetadataMatchCandidateTable;
  metadata_corrections: MetadataCorrectionTable;
}
