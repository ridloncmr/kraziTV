import type { PlaybackMode } from "@krazitv/krazi-brain";

/**
 * How far one channel has advanced through one collection in one playback
 * mode. Ordered modes use the last selection; random uses the selection
 * index; a field the mode does not use stays at its starting value.
 */
export interface ChannelCollectionProgressTable {
  channel_id: string;
  media_collection_id: string;
  playback_mode: PlaybackMode;
  /** Set null when purge deletes the item, so selection falls back to the position. */
  last_media_item_id: string | null;
  last_position: number | null;
  next_selection_index: number;
  /** The first sequence number generated after a reset; restoration ignores earlier entries. */
  reset_sequence_number: number | null;
  /** Metadata modes: identifies the order the schedule was generated from. */
  order_fingerprint: string | null;
  updated_at: number;
}
