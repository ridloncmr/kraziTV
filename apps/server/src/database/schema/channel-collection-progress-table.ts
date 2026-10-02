/** How far one channel has advanced through one collection, per playback mode. */
export interface ChannelCollectionProgressTable {
  channel_id: string;
  media_collection_id: string;
  next_chronological_position: number;
  next_random_selection_index: number;
  updated_at: number;
}
