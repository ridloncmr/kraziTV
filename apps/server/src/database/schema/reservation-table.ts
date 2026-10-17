import type { PlaybackMode } from "@krazitv/krazi-brain";
import type { ColumnType } from "kysely";

/**
 * One reservation (programming spec 0006): an exact start, a stored end,
 * and what airs between them. A program-derived end is computed once from
 * its items' durations when saved and never moves. A collection source
 * names its collection and mode; a media-item list lives in
 * `reservation_items`. Checks enforce each shape. `interrupts` marks one
 * the owner let cut the airing item at its start (ADR 0015).
 */
export interface ReservationTable {
  id: string;
  channel_id: string;
  starts_at: number;
  ends_at: number;
  end_kind: "explicit" | "program_derived";
  source_kind: "media_items" | "collection";
  media_collection_id: string | null;
  playback_mode: PlaybackMode | null;
  /** A 0/1 SQLite boolean that inserts may omit; it defaults to 0. */
  interrupts: ColumnType<number, number | undefined, number>;
  /** The key of the save that created it, so a retry finds it; inserts may omit it. */
  request_key: ColumnType<
    string | null,
    string | null | undefined,
    string | null
  >;
  created_at: number;
  updated_at: number;
}
