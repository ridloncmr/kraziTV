/**
 * A channel's marathon controls; a channel without a row has the defaults.
 * Configuration, so it is kept apart from identity on `channels` and from
 * schedule bookkeeping on `channel_schedule_states`.
 */
export interface ChannelProgrammingSettingsTable {
  channel_id: string;
  /** The chance, 0 to 100, that an eligible round gets a marathon. */
  marathon_chance_percent: number;
  /** Completed ordinary rounds required between marathons. */
  marathon_min_ordinary_rounds: number;
  created_at: number;
  updated_at: number;
}
