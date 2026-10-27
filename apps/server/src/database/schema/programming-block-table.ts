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
  /**
   * The reservation whose programs the block airs, or null for a rotation
   * turn. Plain history with no foreign key, so it outlives the reservation
   * and the block is still known to have taken no turn.
   */
  reservation_id: string | null;
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
  /** Set when a mode or stretch edit ended the turn; generation never continues it. */
  ended_by_edit: SqliteBoolean;
  /** The first active rule naming the turn's show when it started; null when no rule chose it or once the rule is deleted. */
  winning_rule_id: string | null;
  /**
   * The rotation context the turn ran in: `default`, or `rule:` and the
   * sorted active feature rule IDs joined by `+`. A copy of the checkpoint's `activeContext` for queries and
   * diagnostics; generation reads the checkpoint.
   */
  context_key: string;
  /** JSON naming where the turn's ordinary and marathon settings came from. */
  setting_origins: string;
  /** JSON rotation checkpoint from before this turn. */
  checkpoint: string;
  created_at: number;
  updated_at: number;
}
