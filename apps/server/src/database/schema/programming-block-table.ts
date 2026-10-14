import type { PlaybackMode } from "@krazitv/krazi-brain";

import type { SqliteBoolean } from "../columns/sqlite-boolean.js";

type ProgrammingBlockSourceKind = "collection" | "media_item";

/**
 * One generated kraziPlan turn: the member that took it, its resolved
 * size, and the rotation checkpoint from before it. A block is history, like
 * an entry: deleting its assignment or source nulls that reference while
 * `source_kind` and the mode stay, as a check allows.
 */
export interface ProgrammingBlockTable {
  id: string;
  channel_id: string;
  assignment_id: string | null;
  source_kind: ProgrammingBlockSourceKind;
  media_collection_id: string | null;
  media_item_id: string | null;
  playback_mode: PlaybackMode | null;
  round_number: number;
  turn_index: number;
  starts_at: number;
  /** Null together for a single-item turn, which is one airing. */
  resolved_kind: "programs" | "airtime" | null;
  /** A program count, or airtime in integer minutes. */
  resolved_value: number | null;
  marathon: SqliteBoolean;
  /** JSON rotation checkpoint from before this turn. */
  checkpoint: string;
  created_at: number;
  updated_at: number;
}
