import type { CalendarConditions } from "../calendar/contracts.js";
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

/**
 * How an assignment takes part in programming (programming spec 0005): in
 * normal rotation, or only while a winning programming rule selects it. The
 * one list of values; the server's validation and column derive from it.
 */
export const ASSIGNMENT_PARTICIPATIONS = ["default", "rule_only"] as const;

export type AssignmentParticipation =
  (typeof ASSIGNMENT_PARTICIPATIONS)[number];

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
  /**
   * `default` takes turns in normal rotation; `rule_only` airs only while
   * a winning programming rule selects it (programming spec 0005).
   */
  participation: AssignmentParticipation;
  /** Required when a member is a collection; absent for single items only. */
  playbackMode: PlaybackMode | null;
  ordinary: StretchSetting;
  /** A longer turn in the same unit, or null when marathons are disabled. */
  marathon: StretchSetting | null;
  /** Members in saved member order. */
  members: readonly AssignmentMember[];
}

/**
 * How a winning rule changes the active sources (programming spec 0005):
 * `join` adds its sources to normal rotation, and `feature` plays only its
 * own. The one list of values; the server's validation derives from it.
 */
export const RULE_BEHAVIORS = ["join", "feature"] as const;

/** What a rule does to a source's marathon while it wins: keep, turn off, or replace the assignment's. */
export type RuleMarathon =
  | { mode: "inherit" }
  | { mode: "disabled" }
  | { mode: "replace"; stretch: StretchSetting };

/** One assignment a rule selects, with the settings that apply only while it wins. */
export interface RuleSource {
  assignmentId: string;
  /** Replaces the assignment's ordinary stretch; null inherits it. */
  ordinary: StretchSetting | null;
  marathon: RuleMarathon;
}

/** Where a turn's ordinary and marathon settings came from. */
export interface SettingOrigins {
  ordinary: "assignment" | "rule";
  marathon: "assignment" | "rule" | "disabled";
}

/** A programming rule as kraziPlan reads it: enduring channel configuration. */
export interface ProgrammingRule {
  id: string;
  behavior: (typeof RULE_BEHAVIORS)[number];
  /** Higher wins. */
  priority: number;
  /** Saved rule order, which breaks priority ties before the ID does. */
  ruleOrder: number;
  conditions: CalendarConditions;
  /** The assignments the rule selects, in saved source order. */
  sources: readonly RuleSource[];
}

/** The sources a decision lets take turns, and the rotation context they take them in. */
export interface RotationScope {
  /** `default`, which join rules share, or `rule:<id>` for a feature rule. */
  contextKey: string;
  /** Assignments that may take turns, in saved assignment order. */
  eligible: readonly ProgrammingAssignment[];
  /** Those eligible only because the winning rule selects them; only these may join a round under way. */
  ruleDriven: ReadonlySet<string>;
}

/**
 * One rotation context's round (programming spec 0005): the default
 * context's, which join rules share, or one feature rule's own.
 */
export interface RoundState {
  /** Zero before the context's first round. */
  roundNumber: number;
  /** Assignment IDs still owed a turn this round, in turn order. */
  pending: string[];
  served: string[];
  skipped: string[];
  /** Pending assignments that lost eligibility this round; one returning recovers its turn. */
  unservedRemoved: string[];
  /** The round's marathon opportunity, and whether its marathon started. */
  marathonOpportunity: { assignmentId: string; started: boolean } | null;
  /** Whether a turn of this round has committed a program. */
  roundCommittedProgram: boolean;
}

/**
 * The rotation state a generated block stores, as it stood when the block's
 * turn started: the turn's assignment heads its context's `pending`, and
 * its member position names the member that took the turn. The state after
 * the turn is derived from it, so nothing else needs persisting. Rounds are
 * kept per context; member positions, cooldown, and the rebuild count are
 * channel-wide.
 */
export interface RotationCheckpoint {
  /** The context the turn ran in: `default`, or `rule:<id>` for a feature rule. */
  activeContext: string;
  /** Each context's round as it was last left. */
  contexts: Record<string, RoundState>;
  lastAiredAssignmentId: string | null;
  /** Each assignment's next member position, in saved member order; absent means 0. */
  nextMemberPositions: Record<string, number>;
  /** Completed ordinary rounds since the last marathon started; null before any. */
  ordinaryRoundsSinceMarathon: number | null;
  /** The fresh rebuild this slate began with; a later one starts a new slate. */
  rebuildCount: number;
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

/**
 * One generated kraziPlan turn, or one reservation's programs: the
 * programming block persisted for it.
 */
export interface GeneratedBlock {
  id: string;
  /** Null for a reservation's block, and once the assignment is deleted; the block remains as history. */
  assignmentId: string | null;
  /**
   * The reservation whose programs the block airs, or null for a rotation
   * turn. It outlives the reservation, so a block that took no turn is
   * always known.
   */
  reservationId: string | null;
  /**
   * Null once the member's collection or item is deleted, and for a
   * reservation of media items, which its reservation names instead.
   */
  source: BlockSource | null;
  roundNumber: number;
  turnIndex: number;
  startsAt: number;
  /** Null for a single-item turn, which is one airing. */
  size: ResolvedSize | null;
  marathon: boolean;
  /** The rule that won when the turn started, or null for default rotation. */
  winningRuleId: string | null;
  /** Where the settings the turn resolved its size from came from. */
  settingOrigins: SettingOrigins;
  /** A mode or stretch edit ended the turn; generation never continues it. */
  endedByEdit: boolean;
  checkpoint: RotationCheckpoint;
}

/**
 * What a reservation airs (programming spec 0006): an ordered list of media
 * items, or one collection in one playback mode, which consumes the
 * channel's progress like a generated turn.
 */
type ReservationSource =
  | { kind: "media_items"; items: readonly ScheduleMedia[] }
  | {
      kind: "collection";
      mediaCollectionId: string;
      playbackMode: PlaybackMode;
      /** Collection members in saved membership order. */
      members: readonly ScheduleMedia[];
    };

/**
 * A reservation as kraziPlan reads it: an exact start, a stored end, and
 * what airs in the half-open range between them. Ordinary programming stops
 * whole before it and resumes at its end.
 */
export interface Reservation {
  id: string;
  startsAt: number;
  endsAt: number;
  source: ReservationSource;
}

/** A channel's latest kept block and how much of its turn has aired. */
export interface LatestTurn {
  block: GeneratedBlock;
  /**
   * The media each of the block's kept entries airs, in airing order: a
   * turn counts them, and a reserved list resumes after them by identity.
   */
  airedMediaItemIds: readonly string[];
  airedMs: number;
}

/** An assignment a round passed over, and why each of its members cannot air. */
export interface AssignmentSkip {
  assignmentId: string;
  roundNumber: number;
  /** One per member, in saved member order. */
  reasons: UnschedulableReason[];
}

/**
 * An applicable rule a turn's decision passed over, and why: it names no
 * source, or none of its sources can take a turn.
 */
export interface RuleSkip {
  ruleId: string;
  reason: "no_sources" | "no_usable_source";
}

/** Why a channel's programming can produce no entry. */
export type ProgrammingUnschedulableReason =
  "no_programming_assignment" | "no_schedulable_media";
