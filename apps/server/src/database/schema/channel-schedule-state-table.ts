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
  /**
   * Increments once per commit that changes the planned programming a
   * reservation preview shows; coverage extension leaves it alone.
   */
  programming_revision: number;
  /** Unsigned 32-bit seed kraziPlan's decisions hash; independent of `seed`. */
  programming_seed: number;
  /** Fresh rebuilds so far; each one starts new programming decisions. */
  rebuild_count: number;
  /** The idempotency key of the last fresh rebuild, so a retry repeats nothing. */
  last_rebuild_key: string | null;
  created_at: number;
  /** The effective time of the last schedule mutation; never moves backward. */
  updated_at: number;
}
