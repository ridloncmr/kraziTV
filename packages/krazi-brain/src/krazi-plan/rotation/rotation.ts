import type {
  ScheduleSource,
  UnschedulableReason,
} from "../../schedule/contracts.js";
import { findUnschedulableReason } from "../../schedule/schedule-policy.js";
import type {
  AssignmentMember,
  AssignmentSkip,
  BlockSource,
  MarathonSettings,
  ProgrammingAssignment,
  RotationCheckpoint,
  RotationScope,
} from "../contracts.js";
import {
  type DecisionSeed,
  type RoundKey,
  roundKey,
  shuffleRound,
} from "../programming-decisions.js";
import { closeRound, cooldownPermits, drawOpportunity } from "./marathons.js";
import {
  enterContext,
  leaveContext,
  reconcileRound,
  type RotationState,
} from "./rotation-contexts.js";

/** The rotation state of a channel that has never generated a turn. */
export const FIRST_CHECKPOINT: RotationCheckpoint = Object.freeze({
  activeContext: "default",
  contexts: {},
  lastAiredAssignmentId: null,
  nextMemberPositions: {},
  ordinaryRoundsSinceMarathon: null,
  rebuildCount: 0,
});

/**
 * The turn kraziPlan chose: its assignment, the source its member plays,
 * whether it is a marathon, the checkpoint its block stores, and the key
 * its round draws decisions under.
 */
interface ChosenTurn {
  assignment: ProgrammingAssignment;
  member: AssignmentMember;
  source: ScheduleSource;
  marathon: boolean;
  checkpoint: RotationCheckpoint;
  round: RoundKey;
}

/**
 * Returns the rotation state after a block's turn started, from the
 * checkpoint it stored: in the turn's context, its assignment leaves
 * `pending` as served and the round has committed a program; channel-wide,
 * it aired last and its member position moves past the member that took the
 * turn. A marathon marks the round's opportunity started and restarts
 * cooldown as its first program commits; an opportunity its turn did not
 * use is lost. Pure, so the state after any kept block is reproduced
 * exactly, without storing it separately.
 */
export function advancePastTurn(
  checkpoint: RotationCheckpoint,
  marathon: boolean,
): RotationCheckpoint {
  const state = enterContext(checkpoint, checkpoint.activeContext);
  const [assignmentId, ...pending] = state.pending;
  if (assignmentId === undefined) {
    throw new Error("a block's checkpoint must name its turn's assignment");
  }
  const next: RotationState = {
    ...state,
    pending,
    served: [...state.served, assignmentId],
    lastAiredAssignmentId: assignmentId,
    nextMemberPositions: {
      ...state.nextMemberPositions,
      [assignmentId]: (state.nextMemberPositions[assignmentId] ?? 0) + 1,
    },
    roundCommittedProgram: true,
    marathonOpportunity:
      state.marathonOpportunity?.assignmentId !== assignmentId
        ? state.marathonOpportunity
        : marathon
          ? { assignmentId, started: true }
          : null,
    ordinaryRoundsSinceMarathon: marathon
      ? 0
      : state.ordinaryRoundsSinceMarathon,
  };
  return leaveContext(next, checkpoint.activeContext, checkpoint);
}

/** What one selection attempt found: the turn, if any, and every skip it made. */
interface TurnChoice {
  chosen: ChosenTurn | undefined;
  skips: AssignmentSkip[];
}

/**
 * Chooses the next turn in the scope's rotation context (programming specs
 * 0004 and 0005): the context's round is first reconciled with who is
 * eligible now, then the next usable pending assignment takes the turn, or
 * the first of a new round formed from the usable eligible assignments in
 * saved order and shuffled with the seed once the round is spent. A pending
 * assignment that has become unusable is skipped without touching its
 * progress and waits for the next round. Each assignment is examined once
 * per attempt, and at most one new round is formed, so a scope with nothing
 * usable reports no turn instead of forming empty rounds forever.
 */
export function chooseTurn(
  checkpoint: RotationCheckpoint,
  scope: RotationScope,
  seed: DecisionSeed,
  marathons: MarathonSettings,
): TurnChoice {
  const assignments = scope.eligible;
  const key = (roundNumber: number) => roundKey(scope.contextKey, roundNumber);
  const reasons = new Map(
    assignments.map((assignment) => [
      assignment.id,
      unusableReasons(assignment),
    ]),
  );
  const skips: AssignmentSkip[] = [];
  const skip = (round: RotationState, assignmentId: string) => {
    skips.push({
      assignmentId,
      roundNumber: round.roundNumber,
      reasons: reasons.get(assignmentId) ?? [],
    });
    return assignmentId;
  };

  const entered = enterContext(checkpoint, scope.contextKey);
  const state = reconcileRound(entered, scope, seed, key(entered.roundNumber));
  let round: RotationState = {
    ...state,
    pending: state.pending.filter((id) => reasons.get(id) === undefined),
    skipped: [
      ...state.skipped,
      ...state.pending
        .filter((id) => reasons.get(id) !== undefined)
        .map((id) => skip(state, id)),
    ],
  };
  if (round.pending.length === 0) {
    const usable = assignments.filter(
      ({ id }) => reasons.get(id) === undefined,
    );
    if (usable.length === 0) {
      // Report the round the channel would have formed, so a preview can explain it.
      const formed = { ...round, roundNumber: round.roundNumber + 1 };
      for (const { id } of assignments) skip(formed, id);
      return { chosen: undefined, skips };
    }
    const roundNumber = round.roundNumber + 1;
    const formed: RotationState = {
      ...round,
      ordinaryRoundsSinceMarathon: closeRound(round),
      roundNumber,
      pending: shuffleRound(
        usable.map(({ id }) => id),
        seed,
        key(roundNumber),
      ),
      served: [],
      skipped: [],
      unservedRemoved: [],
      marathonOpportunity: null,
      roundCommittedProgram: false,
    };
    round = {
      ...formed,
      marathonOpportunity: drawOpportunity(
        formed,
        usable,
        marathons,
        seed,
        key(roundNumber),
      ),
      skipped: assignments
        .filter(({ id }) => reasons.get(id) !== undefined)
        .map(({ id }) => skip(formed, id)),
    };
  }

  round = {
    ...round,
    pending: avoidRepeat(round.pending, round.lastAiredAssignmentId),
  };
  const assignment = assignments.find(({ id }) => id === round.pending[0]);
  const chosen =
    assignment === undefined
      ? undefined
      : firstUsableMember(
          assignment,
          round.nextMemberPositions[assignment.id] ?? 0,
        );
  if (assignment === undefined || chosen === undefined) {
    throw new Error("a usable pending assignment must have a usable member");
  }
  // The round's opportunity becomes a marathon only on a collection, and
  // only if cooldown still permits now that its turn starts; otherwise it
  // is lost without a reroll.
  const opportunity = round.marathonOpportunity;
  const marathon =
    opportunity?.assignmentId === assignment.id &&
    !opportunity.started &&
    chosen.member.kind === "collection" &&
    assignment.marathon !== null &&
    cooldownPermits(round, marathons);
  return {
    chosen: {
      assignment,
      member: chosen.member,
      source: chosen.source,
      marathon,
      checkpoint: leaveContext(
        {
          ...round,
          nextMemberPositions: {
            ...round.nextMemberPositions,
            [assignment.id]: chosen.position,
          },
        },
        scope.contextKey,
        checkpoint,
      ),
      round: key(round.roundNumber),
    },
    skips,
  };
}

/**
 * Moves the first pending assignment behind the next one when it is the one
 * that last aired, so a source never repeats back to back while another
 * pending source can play. With only one pending, the repeat stands rather
 * than inventing a turn.
 */
function avoidRepeat(
  pending: readonly string[],
  lastAiredAssignmentId: string | null,
): string[] {
  const [first, second, ...rest] = pending;
  return first === lastAiredAssignmentId && second !== undefined
    ? [second, first, ...rest]
    : [...pending];
}

/**
 * Whether an assignment can take a turn: some member is schedulable. The
 * one usability rule, so callers outside kraziPlan, such as catalog
 * removal's warning, ask it rather than restate it.
 */
export function isUsableAssignment(assignment: ProgrammingAssignment): boolean {
  return unusableReasons(assignment) === undefined;
}

/**
 * Returns why an assignment cannot take a turn, one reason per member in
 * saved member order, or undefined when some member is schedulable.
 */
function unusableReasons(
  assignment: ProgrammingAssignment,
): UnschedulableReason[] | undefined {
  if (firstUsableMember(assignment, 0) !== undefined) return undefined;
  return assignment.members.map((member) => {
    const source = memberSource(assignment, member, "");
    return (
      (source === undefined ? null : findUnschedulableReason(source)) ??
      "no_schedulable_members"
    );
  });
}

/**
 * Finds the first schedulable member at or after `from` in saved member
 * order, wrapping, with its position. An unschedulable member is passed
 * over without touching its progress.
 */
function firstUsableMember(
  assignment: ProgrammingAssignment,
  from: number,
):
  | { member: AssignmentMember; source: ScheduleSource; position: number }
  | undefined {
  const { members } = assignment;
  for (let step = 0; step < members.length; step += 1) {
    const position = (from + step) % members.length;
    const member = members[position];
    if (member === undefined) continue;
    const source = memberSource(assignment, member, "");
    if (source !== undefined && findUnschedulableReason(source) === null) {
      return { member, source, position };
    }
  }
  return undefined;
}

/**
 * Builds the source a member's turn generates from, in the assignment's
 * playback mode. A collection member of an assignment without a mode has
 * no way to play, so it has no source.
 */
export function memberSource(
  assignment: ProgrammingAssignment,
  member: AssignmentMember,
  programmingBlockId: string,
): ScheduleSource | undefined {
  if (member.kind === "media_item") {
    return { kind: "media_item", programmingBlockId, media: member.media };
  }
  if (assignment.playbackMode === null) return undefined;
  return {
    kind: "collection",
    programmingBlockId,
    mediaCollectionId: member.mediaCollectionId,
    playbackMode: assignment.playbackMode,
    members: member.members,
  };
}

/**
 * Finds the member a block's source names in the assignment as it stands
 * now. A collection matches only in the mode the block played, so a mode
 * change never continues the old turn in the new mode.
 */
export function findBlockMember(
  assignment: ProgrammingAssignment,
  source: BlockSource,
): AssignmentMember | undefined {
  return assignment.members.find((member) =>
    member.kind === "media_item"
      ? source.kind === "media_item" && source.mediaItemId === member.media.id
      : source.kind === "collection" &&
        source.mediaCollectionId === member.mediaCollectionId &&
        source.playbackMode === assignment.playbackMode,
  );
}
