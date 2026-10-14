import type { ScheduleSource } from "../schedule/contracts.js";
import { findUnschedulableReason } from "../schedule/schedule-policy.js";
import type {
  AssignmentMember,
  BlockSource,
  ProgrammingAssignment,
  RotationCheckpoint,
} from "./contracts.js";

/** The rotation state of a channel that has never generated a turn. */
export const FIRST_CHECKPOINT: RotationCheckpoint = Object.freeze({
  roundNumber: 0,
  pending: [],
  served: [],
  skipped: [],
  lastAiredAssignmentId: null,
  nextMemberPositions: {},
  marathonOpportunity: null,
  roundCommittedProgram: false,
  ordinaryRoundsSinceMarathon: null,
});

/** The turn kraziPlan chose: its assignment, the source its member plays, and the checkpoint its block stores. */
interface ChosenTurn {
  assignment: ProgrammingAssignment;
  member: AssignmentMember;
  source: ScheduleSource;
  checkpoint: RotationCheckpoint;
}

/**
 * Returns the rotation state after a block's turn started, from the
 * checkpoint it stored: its assignment leaves `pending` as served and last
 * aired, its member position moves past the member that took the turn, and
 * the round has committed a program. Pure, so the state after any kept
 * block is reproduced exactly, without storing it separately.
 */
export function advancePastTurn(
  checkpoint: RotationCheckpoint,
): RotationCheckpoint {
  const [assignmentId, ...pending] = checkpoint.pending;
  if (assignmentId === undefined) {
    throw new Error("a block's checkpoint must name its turn's assignment");
  }
  return {
    ...checkpoint,
    pending,
    served: [...checkpoint.served, assignmentId],
    lastAiredAssignmentId: assignmentId,
    nextMemberPositions: {
      ...checkpoint.nextMemberPositions,
      [assignmentId]: (checkpoint.nextMemberPositions[assignmentId] ?? 0) + 1,
    },
    roundCommittedProgram: true,
  };
}

/**
 * Chooses the next turn from the rotation state: the next pending
 * assignment of the current round, or the first of a new round formed from
 * usable assignments in saved order once the current one is spent. Returns
 * undefined when no assignment is usable, so the caller reports the channel
 * unschedulable instead of forming empty rounds.
 */
export function chooseTurn(
  state: RotationCheckpoint,
  assignments: readonly ProgrammingAssignment[],
): ChosenTurn | undefined {
  const usable = assignments.filter(
    (assignment) => firstUsableMember(assignment, 0) !== undefined,
  );
  if (usable.length === 0) return undefined;
  const round =
    state.pending.length > 0
      ? state
      : {
          ...state,
          roundNumber: state.roundNumber + 1,
          pending: usable.map((assignment) => assignment.id),
          served: [],
          skipped: [],
          marathonOpportunity: null,
          roundCommittedProgram: false,
        };
  const assignment = usable.find(({ id }) => id === round.pending[0]);
  if (assignment === undefined) return undefined;
  const chosen = firstUsableMember(
    assignment,
    round.nextMemberPositions[assignment.id] ?? 0,
  );
  if (chosen === undefined) return undefined;
  return {
    assignment,
    member: chosen.member,
    source: chosen.source,
    checkpoint: {
      ...round,
      nextMemberPositions: {
        ...round.nextMemberPositions,
        [assignment.id]: chosen.position,
      },
    },
  };
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
