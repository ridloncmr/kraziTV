import type {
  PlaybackMode,
  ScheduleMedia,
  UnschedulableReason,
} from "../schedule/contracts.js";

/**
 * How long one turn of an assignment runs (programming spec 0004): a fixed
 * number of whole programs, an airtime target, or an airtime range a turn
 * picks its target from. Airtime is in integer minutes; a turn always airs
 * whole programs, so it may run past its target.
 */
export type StretchSetting =
  | { kind: "programs"; count: number }
  | { kind: "airtime"; minutes: number }
  | { kind: "airtime_range"; minMinutes: number; maxMinutes: number };

/** A channel's marathon controls, shared by every rotation context. */
export interface MarathonSettings {
  /** The chance, 0 to 100, that an eligible round gets a marathon. */
  chancePercent: number;
  /** Completed ordinary rounds required between marathons. */
  minOrdinaryRounds: number;
}

/** One member of an assignment, with its media resolved from the catalog. */
export type AssignmentMember =
  | {
      kind: "collection";
      mediaCollectionId: string;
      /** Collection members in saved membership order. */
      members: readonly ScheduleMedia[];
    }
  | { kind: "media_item"; media: ScheduleMedia };

/**
 * A programming source assignment as kraziPlan reads it: enduring channel
 * configuration with its members resolved, in saved assignment order.
 */
export interface ProgrammingAssignment {
  id: string;
  /** Required when a member is a collection; absent for single items only. */
  playbackMode: PlaybackMode | null;
  ordinary: StretchSetting;
  /** A longer turn in the same unit, or null when marathons are disabled. */
  marathon: StretchSetting | null;
  /** Members in saved member order. */
  members: readonly AssignmentMember[];
}

/**
 * The rotation state a generated block stores, as it stood when the block's
 * turn started: the turn's assignment heads `pending`, and its member
 * position names the member that took the turn. The state after the turn is
 * derived from it, so nothing else needs persisting.
 */
export interface RotationCheckpoint {
  /** Zero before the first round. */
  roundNumber: number;
  /** Assignment IDs still owed a turn this round, in turn order. */
  pending: string[];
  served: string[];
  skipped: string[];
  lastAiredAssignmentId: string | null;
  /** Each assignment's next member position, in saved member order; absent means 0. */
  nextMemberPositions: Record<string, number>;
  /** The round's marathon opportunity, and whether its marathon started. */
  marathonOpportunity: { assignmentId: string; started: boolean } | null;
  /** Whether a turn of this round has committed a program. */
  roundCommittedProgram: boolean;
  /** Completed ordinary rounds since the last marathon started; null before any. */
  ordinaryRoundsSinceMarathon: number | null;
}

/** The member that took a block's turn. */
export type BlockSource =
  | {
      kind: "collection";
      mediaCollectionId: string;
      playbackMode: PlaybackMode;
    }
  | { kind: "media_item"; mediaItemId: string };

/** What a turn resolved its stretch to; airtime is in integer minutes. */
export interface ResolvedSize {
  kind: "programs" | "airtime";
  value: number;
}

/** One generated kraziPlan turn: the programming block persisted for it. */
export interface GeneratedBlock {
  id: string;
  /** Null once the assignment is deleted; the block remains as history. */
  assignmentId: string | null;
  /** Null once the member's collection or item is deleted. */
  source: BlockSource | null;
  roundNumber: number;
  turnIndex: number;
  startsAt: number;
  /** Null for a single-item turn, which is one airing. */
  size: ResolvedSize | null;
  marathon: boolean;
  /** A mode or stretch edit ended the turn; generation never continues it. */
  endedByEdit: boolean;
  checkpoint: RotationCheckpoint;
}

/** A channel's latest kept block and how much of its turn has aired. */
export interface LatestTurn {
  block: GeneratedBlock;
  airedPrograms: number;
  airedMs: number;
}

/** An assignment a round passed over, and why each of its members cannot air. */
export interface AssignmentSkip {
  assignmentId: string;
  roundNumber: number;
  /** One per member, in saved member order. */
  reasons: UnschedulableReason[];
}

/** Why a channel's programming can produce no entry. */
export type ProgrammingUnschedulableReason =
  "no_programming_assignment" | "no_schedulable_media";
