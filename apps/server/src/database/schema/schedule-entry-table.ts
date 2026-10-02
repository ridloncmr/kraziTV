import type { PlaybackMode } from "./programming-block-table.js";

/**
 * One guide-visible program. `playback_mode` and `playback_index` are null
 * together, for a single-item block; a deleted block or collection leaves
 * its entries as history with that reference nulled.
 */
export interface ScheduleEntryTable {
  id: string;
  channel_id: string;
  media_item_id: string;
  /** Copied at generation so the guide stays stable across rescans. */
  title: string;
  starts_at: number;
  ends_at: number;
  duration_ms: number;
  sequence_number: number;
  programming_block_id: string | null;
  media_collection_id: string | null;
  playback_mode: PlaybackMode | null;
  playback_index: number | null;
  created_at: number;
  updated_at: number;
}
