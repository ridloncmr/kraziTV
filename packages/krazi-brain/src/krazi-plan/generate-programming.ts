import {
  type CollectionProgress,
  type GeneratedScheduleEntry,
  type GenerationResult,
  NO_PROGRESS,
  type ScheduleSource,
  type TurnSize,
} from "../schedule/contracts.js";
import { generateScheduleEntries } from "../schedule/generate-schedule-entries.js";
import { progressKey } from "../schedule/regeneration.js";
import { findUnschedulableReason } from "../schedule/schedule-policy.js";
import type {
  AssignmentSkip,
  BlockSource,
  GeneratedBlock,
  LatestTurn,
  MarathonSettings,
  ProgrammingAssignment,
  ProgrammingRule,
  ProgrammingUnschedulableReason,
  Reservation,
  RuleSkip,
} from "./contracts.js";
import {
  advancePastTurn,
  chooseTurn,
  findBlockMember,
  FIRST_CHECKPOINT,
  memberSource,
} from "./rotation/rotation.js";
import type { DecisionSeed } from "./programming-decisions.js";
import {
  airReservation,
  findNextReservation,
  findReservationAt,
  reservationEndedTurn,
} from "./reservations/reservation-programs.js";
import { findNamingRule, settingOrigins } from "./rules/rule-settings.js";
import { decideRule, ruleScope } from "./rules/active-rules.js";
import { resolveSize } from "./stretches/stretch-settings.js";
import { turnSize } from "./stretches/turn-size.js";

export interface GenerateProgrammingOptions extends DecisionSeed {
  /** The channel's marathon chance and cooldown. */
  marathons: MarathonSettings;
  /** The channel's persisted seed; collection random playback derives from it. */
  channelSeed: number;
  /** The channel's assignments in saved assignment order. */
  assignments: readonly ProgrammingAssignment[];
  /** The channel's programming rules, in any order; kraziPlan ranks them. */
  rules: readonly ProgrammingRule[];
  /**
   * The channel's reservations, in any order and never overlapping.
   * Ordinary programs stop whole before each one, and its own programs air
   * from its start until the next would end past its end.
   */
  reservations: readonly Reservation[];
  /** The server-wide IANA programming timezone rules are evaluated in. */
  timeZone: string;
  /** The channel's latest kept block, or undefined before its first turn. */
  latestTurn: LatestTurn | undefined;
  /** The channel's progress for collections its assignments play; absent means none yet. */
  progress: readonly CollectionProgress[];
  startsAt: number;
  /**
   * No ordinary entry starts at or after this instant; the last one may end
   * past it. A reservation generation has entered still airs to its end.
   */
  through: number;
  nextSequenceNumber: number;
  /** Caps one call so a caller can persist long horizons in bounded chunks. */
  maxEntries: number;
  /** Names each new block; IDs are provenance, never entropy. */
  createBlockId: () => string;
}

type ProgrammingResult =
  | { kind: "unschedulable"; reason: ProgrammingUnschedulableReason }
  | {
      kind: "generated";
      /** Blocks started by this call, each holding at least one of its entries. */
      blocks: GeneratedBlock[];
      entries: GeneratedScheduleEntry[];
      /** Progress for each collection and mode this call advanced. */
      progress: CollectionProgress[];
      /** Assignments the call's rounds passed over, for explaining them. */
      skips: AssignmentSkip[];
      /** Applicable rules each new block's decision dropped as unusable, for explaining them. */
      ruleSkips: (RuleSkip & { blockId: string })[];
      nextSequenceNumber: number;
      /**
       * Where coverage now reaches: the end of the last entry, or of any
       * reservation entered, past whose last program filler covers the rest.
       */
      generatedThrough: number;
    };

/** The turn generation is running: whose it is, where its entries go, and how far it has to go. */
interface OpenTurn {
  assignmentId: string;
  source: ScheduleSource;
  size: TurnSize;
}

/**
 * Generates a channel's programming from `startsAt`: before every program
 * it asks which programming rules are active, continues the latest turn
 * while its assignment stays eligible in the same rotation context and its
 * size is unmet, and otherwise asks kraziPlan for the next turn and lets schedule
 * generation choose its whole programs. A program is never cut for a
 * calendar window; the next one follows current eligibility. Reservations
 * are hard ends (programming spec 0006): the next program that cannot
 * finish before one is deferred, a turn it interrupts is over, and a turn
 * none of whose programs fit is dropped and drawn again identically after
 * the reservation, whose own programs air from its exact start. Stops at
 * `through` or `maxEntries`, and returns what to persist so the next call
 * resumes exactly, from the blocks and progress alone. Never touches
 * persistence; the output depends only on the inputs.
 */
export function generateProgramming(
  options: GenerateProgrammingOptions,
): ProgrammingResult {
  const { assignments, latestTurn, through, maxEntries } = options;
  const reservations = [...options.reservations].sort(
    (a, b) => a.startsAt - b.startsAt,
  );
  // A reservation still to come airs even without ordinary programming.
  if (
    assignments.length === 0 &&
    !reservations.some(({ endsAt }) => endsAt > options.startsAt)
  ) {
    return { kind: "unschedulable", reason: "no_programming_assignment" };
  }
  const progress = new Map(
    options.progress.map((entry) => [
      progressKey(entry.mediaCollectionId, entry.playbackMode),
      entry,
    ]),
  );
  const advanced = new Set<string>();
  const blocks: GeneratedBlock[] = [];
  const entries: GeneratedScheduleEntry[] = [];
  const skips: AssignmentSkip[] = [];
  const ruleSkips: (RuleSkip & { blockId: string })[] = [];
  // A latest block from before a fresh rebuild belongs to a finished slate:
  // its turn is never continued and its rounds, cooldown, and member
  // positions are not carried over. Collection progress still is.
  const continued =
    latestTurn?.block.checkpoint.rebuildCount === options.rebuildCount
      ? latestTurn
      : undefined;
  // A reservation's block took no turn, so its state stands as it is.
  let state =
    continued === undefined
      ? { ...FIRST_CHECKPOINT, rebuildCount: options.rebuildCount }
      : continued.block.reservationId !== null
        ? continued.block.checkpoint
        : advancePastTurn(continued.block.checkpoint, continued.block.marathon);
  let open =
    continued === undefined || continued.block.reservationId !== null
      ? undefined
      : resumeTurn(continued, assignments, reservations, options.startsAt);
  let startsAt = options.startsAt;
  let sequenceNumber = options.nextSequenceNumber;
  let decision: ReturnType<typeof decideRule> | undefined;

  // Generates from one source at `startsAt` and keeps its entries and
  // progress, so ordinary turns and collection reservations share one path.
  const airSource = (
    source: ScheduleSource,
    window: { through: number; hardEnd: number | undefined; turn?: TurnSize },
  ): GenerationResult => {
    const key =
      source.kind === "collection"
        ? progressKey(source.mediaCollectionId, source.playbackMode)
        : undefined;
    const generated = generateScheduleEntries({
      channelSeed: options.channelSeed,
      source,
      progress:
        (key === undefined ? undefined : progress.get(key)?.progress) ??
        NO_PROGRESS,
      startsAt,
      through: window.through,
      hardEnd: window.hardEnd,
      nextSequenceNumber: sequenceNumber,
      maxEntries: maxEntries - entries.length,
      turn: window.turn,
    });
    if (generated.kind !== "generated" || generated.entries.length === 0) {
      return generated;
    }
    entries.push(...generated.entries);
    sequenceNumber = generated.nextSequenceNumber;
    if (key !== undefined && source.kind === "collection") {
      progress.set(key, {
        mediaCollectionId: source.mediaCollectionId,
        playbackMode: source.playbackMode,
        progress: generated.progress,
      });
      advanced.add(key);
    }
    return generated;
  };

  while (entries.length < maxEntries) {
    const reservation = findReservationAt(reservations, startsAt);
    if (reservation !== undefined) {
      const aired = airReservation(reservation, {
        startsAt,
        kept: entries.length === 0 ? latestTurn : undefined,
        previousEntry: entries.at(-1),
        state,
        nextSequenceNumber: sequenceNumber,
        maxEntries: maxEntries - entries.length,
        createBlockId: options.createBlockId,
        airCollection: (source) =>
          airSource(source, {
            through: reservation.endsAt,
            hardEnd: reservation.endsAt,
          }),
      });
      entries.push(...aired.entries);
      sequenceNumber += aired.entries.length;
      if (aired.started !== undefined) blocks.push(aired.started);
      open = undefined;
      startsAt = aired.continuesAt;
      continue;
    }
    if (startsAt >= through) break;

    // The active rules stand until some rule's applicability can change,
    // so it is decided again only at the first program from then on.
    if (decision === undefined || startsAt >= decision.validUntil) {
      decision = decideRule(
        options.rules,
        assignments,
        startsAt,
        options.timeZone,
      );
    }
    const scope = ruleScope(decision.active, assignments);
    // Eligibility loss or a change of context ends a started turn here, at
    // a program boundary; its remainder is discarded without debt.
    const openId = open?.assignmentId;
    if (
      state.activeContext !== scope.contextKey ||
      !scope.eligible.some(({ id }) => id === openId)
    ) {
      open = undefined;
    }
    let chosen:
      | {
          block: GeneratedBlock;
          before: typeof state;
          skips: AssignmentSkip[];
        }
      | undefined;
    if (open === undefined) {
      const { chosen: turn, skips: skipped } = chooseTurn(
        state,
        scope,
        options,
        options.marathons,
      );
      if (turn === undefined) {
        skips.push(...skipped);
        // With nothing ordinary to air, filler covers the time until the
        // next reservation, which airs at its exact start regardless.
        const next = findNextReservation(reservations, startsAt);
        if (next !== undefined && next.startsAt < through) {
          open = undefined;
          startsAt = next.startsAt;
          continue;
        }
        // A later program could only come from a calendar change, which
        // generation does not wait for, so coverage stops here.
        if (entries.length > 0) break;
        return {
          kind: "unschedulable",
          reason:
            assignments.length === 0
              ? "no_programming_assignment"
              : "no_schedulable_media",
        };
      }
      const position = {
        roundNumber:
          turn.checkpoint.contexts[scope.contextKey]?.roundNumber ?? 0,
        turnIndex:
          turn.checkpoint.contexts[scope.contextKey]?.served.length ?? 0,
      };
      const block: GeneratedBlock = {
        id: options.createBlockId(),
        assignmentId: turn.assignment.id,
        reservationId: null,
        source: toBlockSource(turn.source),
        ...position,
        startsAt,
        size: resolveSize(
          turn.member,
          (turn.marathon ? turn.assignment.marathon : null) ??
            turn.assignment.ordinary,
          turn.marathon ? "marathon_size" : "size",
          options,
          { round: turn.round, turnIndex: position.turnIndex },
        ),
        marathon: turn.marathon,
        winningRuleId:
          findNamingRule(decision.active, turn.assignment.id)?.id ?? null,
        settingOrigins: settingOrigins(decision.active, turn.assignment.id),
        endedByEdit: false,
        checkpoint: turn.checkpoint,
      };
      chosen = { block, before: state, skips: skipped };
      state = advancePastTurn(turn.checkpoint, turn.marathon);
      open = {
        assignmentId: turn.assignment.id,
        source: { ...turn.source, programmingBlockId: block.id },
        size: turnSize(block.size),
      };
    }

    const hardEnd = findNextReservation(reservations, startsAt)?.startsAt;
    const generated = airSource(open.source, {
      // Every program starting before the decision can change shares its rules.
      through: Math.min(through, decision.validUntil),
      hardEnd,
      turn: open.size,
    });
    // An open turn's member is always schedulable, so this never happens.
    if (generated.kind !== "generated" || generated.turn === undefined) {
      throw new Error("an open turn must generate from a schedulable member");
    }
    if (chosen !== undefined) {
      if (generated.entries.length === 0 && generated.deferred) {
        // The turn never started, so the same decision is drawn again
        // after the reservation, as if it had never been made.
        state = chosen.before;
      } else {
        blocks.push(chosen.block);
        skips.push(...chosen.skips);
        for (const skip of decision.passedOver) {
          ruleSkips.push({ blockId: chosen.block.id, ...skip });
        }
      }
    }
    startsAt = generated.generatedThrough;
    if (generated.deferred && hardEnd !== undefined) {
      // The deferred program waits for the next turn; filler covers the
      // time until the reservation starts.
      open = undefined;
      startsAt = hardEnd;
      continue;
    }
    open =
      generated.turn.accumulated < generated.turn.target
        ? { ...open, size: generated.turn }
        : undefined;
  }

  return {
    kind: "generated",
    blocks,
    entries,
    progress: [...advanced].flatMap((key) => progress.get(key) ?? []),
    skips,
    ruleSkips,
    nextSequenceNumber: sequenceNumber,
    generatedThrough: startsAt,
  };
}

/**
 * Returns the latest turn to continue, or undefined when it is over: an
 * edit or a reservation ended it, its size is met, or its assignment, its
 * member, or the member's mode no longer stands as it did, or its member
 * has nothing left to air. Whether it is still eligible is decided before
 * each program.
 */
function resumeTurn(
  latest: LatestTurn,
  assignments: readonly ProgrammingAssignment[],
  reservations: readonly Reservation[],
  startsAt: number,
): OpenTurn | undefined {
  const { block } = latest;
  const assignment = assignments.find(({ id }) => id === block.assignmentId);
  if (
    block.endedByEdit ||
    assignment === undefined ||
    block.source === null ||
    reservationEndedTurn(reservations, block.startsAt, startsAt)
  ) {
    return undefined;
  }
  const member = findBlockMember(assignment, block.source);
  const source =
    member === undefined
      ? undefined
      : memberSource(assignment, member, block.id);
  if (source === undefined || findUnschedulableReason(source) !== null) {
    return undefined;
  }
  const size = turnSize(block.size, latest);
  return size.accumulated < size.target
    ? { assignmentId: assignment.id, source, size }
    : undefined;
}

/** Names the member a block records, as its source columns persist it. */
function toBlockSource(source: ScheduleSource): BlockSource {
  return source.kind === "media_item"
    ? { kind: "media_item", mediaItemId: source.media.id }
    : {
        kind: "collection",
        mediaCollectionId: source.mediaCollectionId,
        playbackMode: source.playbackMode,
      };
}
