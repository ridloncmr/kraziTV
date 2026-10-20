import type {
  AssignmentParticipation,
  PlaybackMode,
} from "@krazitv/krazi-brain";

/** The stretch kinds an assignment's ordinary and marathon settings take. */
export type StretchKind = "programs" | "airtime" | "airtime_range";

/**
 * One programming source assignment: enduring channel configuration that
 * kraziPlan rotates. Its members live in `programming_assignment_members`.
 * A stretch is a count or integer minutes in `*_min`, plus `*_max` for a
 * range only; checks enforce each shape. The marathon columns are null
 * together when it is disabled.
 */
export interface ProgrammingSourceAssignmentTable {
  id: string;
  channel_id: string;
  /** The owner's name for the show, or null to name it by its members. */
  name: string | null;
  /** Required by the API when a member is a collection. */
  playback_mode: PlaybackMode | null;
  participation: AssignmentParticipation;
  /** Saved assignment order; ties break by ID. */
  assignment_order: number;
  ordinary_kind: StretchKind;
  ordinary_min: number;
  ordinary_max: number | null;
  marathon_kind: StretchKind | null;
  marathon_min: number | null;
  marathon_max: number | null;
  created_at: number;
  updated_at: number;
}
