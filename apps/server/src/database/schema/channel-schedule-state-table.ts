/** One row per channel that has ever generated a schedule; written only by schedule mutations. */
export interface ChannelScheduleStateTable {
  channel_id: string;
  /** Unsigned 32-bit seed derived once from the channel and its anchor. */
  seed: number;
  anchor_time: number;
  /** The end of the last generated entry; coverage extends from here. */
  last_generated_through: number;
  next_sequence_number: number;
  /** Increments once per commit that inserts or deletes an entry. */
  schedule_revision: number;
  created_at: number;
  /** The effective time of the last schedule mutation; never moves backward. */
  updated_at: number;
}
