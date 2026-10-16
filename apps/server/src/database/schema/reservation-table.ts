import type { PlaybackMode } from "@krazitv/krazi-brain";

/**
 * One reservation (programming spec 0006): an exact start, a stored end,
 * and what airs between them. A program-derived end is computed once from
 * its items' durations when saved and never moves. A collection source
 * names its collection and mode; a media-item list lives in
 * `reservation_items`. Checks enforce each shape.
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
  created_at: number;
  updated_at: number;
}
