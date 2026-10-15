import {
  type CollectionProgress,
  type GeneratedScheduleEntry,
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
  ProgrammingUnschedulableReason,
} from "./contracts.js";
import {
  advancePastTurn,
  chooseTurn,
  findBlockMember,
  FIRST_CHECKPOINT,
  memberSource,
} from "./rotation.js";
import type { DecisionSeed } from "./programming-decisions.js";
import { resolveSize } from "./stretch-settings.js";
import { turnSize } from "./turn-size.js";

export interface GenerateProgrammingOptions extends DecisionSeed {
  /** The channel's marathon chance and cooldown. */
  marathons: MarathonSettings;
  /** The channel's persisted seed; collection random playback derives from it. */
  channelSeed: number;
  /** The channel's assignments in saved assignment order. */
  assignments: readonly ProgrammingAssignment[];
  /** The channel's latest kept block, or undefined before its first turn. */
  latestTurn: LatestTurn | undefined;
  /** The channel's progress for collections its assignments play; absent means none yet. */
  progress: readonly CollectionProgress[];
  startsAt: number;
  /** No entry starts at or after this instant; the last one may end past it. */
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
      nextSequenceNumber: number;
      /** The end of the last entry, or `startsAt` when none was generated. */
      generatedThrough: number;
    };

/** The turn generation is running: where its entries go, and how far it has to go. */
interface OpenTurn {
  source: ScheduleSource;
  size: TurnSize;
}

/**
 * Generates a channel's programming from `startsAt`: continues the latest
 * turn until its size is met, then asks kraziPlan for each next turn and
 * lets schedule generation choose its whole programs. Stops at `through`
 * or `maxEntries`, and returns what to persist so the next call resumes
 * exactly, from the blocks and progress alone. Never touches persistence;
 * the output depends only on the inputs.
 */
export function generateProgramming(
  options: GenerateProgrammingOptions,
): ProgrammingResult {
  const { assignments, latestTurn, through, maxEntries } = options;
  if (assignments.length === 0) {
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
  let state =
    latestTurn === undefined
      ? FIRST_CHECKPOINT
      : advancePastTurn(latestTurn.block.checkpoint, latestTurn.block.marathon);
  let open =
    latestTurn === undefined ? undefined : resumeTurn(latestTurn, assignments);
  let startsAt = options.startsAt;
  let sequenceNumber = options.nextSequenceNumber;

  while (startsAt < through && entries.length < maxEntries) {
    if (open === undefined) {
      const { chosen: turn, skips: skipped } = chooseTurn(
        state,
        assignments,
        options,
        options.marathons,
      );
      skips.push(...skipped);
      if (turn === undefined) {
        // Usability is fixed within one call, so only a first choice fails.
        if (entries.length > 0) break;
        return { kind: "unschedulable", reason: "no_schedulable_media" };
      }
      const block: GeneratedBlock = {
        id: options.createBlockId(),
        assignmentId: turn.assignment.id,
        source: toBlockSource(turn.source),
        roundNumber: turn.checkpoint.roundNumber,
        turnIndex: turn.checkpoint.served.length,
        startsAt,
        size: resolveSize(
          turn.member,
          (turn.marathon ? turn.assignment.marathon : null) ??
            turn.assignment.ordinary,
          turn.marathon ? "marathon_size" : "size",
          options,
          {
            roundNumber: turn.checkpoint.roundNumber,
            turnIndex: turn.checkpoint.served.length,
          },
        ),
        marathon: turn.marathon,
        checkpoint: turn.checkpoint,
      };
      blocks.push(block);
      state = advancePastTurn(turn.checkpoint, turn.marathon);
      open = {
        source: { ...turn.source, programmingBlockId: block.id },
        size: turnSize(block.size),
      };
    }

    const key =
      open.source.kind === "collection"
        ? progressKey(open.source.mediaCollectionId, open.source.playbackMode)
        : undefined;
    const generated = generateScheduleEntries({
      channelSeed: options.channelSeed,
      source: open.source,
      progress:
        (key === undefined ? undefined : progress.get(key)?.progress) ??
        NO_PROGRESS,
      startsAt,
      through,
      nextSequenceNumber: sequenceNumber,
      maxEntries: maxEntries - entries.length,
      turn: open.size,
    });
    // An open turn's member is always schedulable, so this never happens.
    if (generated.kind !== "generated" || generated.turn === undefined) {
      throw new Error("an open turn must generate from a schedulable member");
    }
    entries.push(...generated.entries);
    startsAt = generated.generatedThrough;
    sequenceNumber = generated.nextSequenceNumber;
    if (key !== undefined && open.source.kind === "collection") {
      progress.set(key, {
        mediaCollectionId: open.source.mediaCollectionId,
        playbackMode: open.source.playbackMode,
        progress: generated.progress,
      });
      advanced.add(key);
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
    nextSequenceNumber: sequenceNumber,
    generatedThrough: startsAt,
  };
}

/**
 * Returns the latest turn to continue, or undefined when it is over: its
 * size is met, or its assignment, its member, or the member's mode no longer
 * stands as it did, or its member has nothing left to air.
 */
function resumeTurn(
  latest: LatestTurn,
  assignments: readonly ProgrammingAssignment[],
): OpenTurn | undefined {
  const { block } = latest;
  const assignment = assignments.find(({ id }) => id === block.assignmentId);
  if (assignment === undefined || block.source === null) return undefined;
  const member = findBlockMember(assignment, block.source);
  const source =
    member === undefined
      ? undefined
      : memberSource(assignment, member, block.id);
  if (source === undefined || findUnschedulableReason(source) !== null) {
    return undefined;
  }
  const size = turnSize(block.size, latest);
  return size.accumulated < size.target ? { source, size } : undefined;
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
