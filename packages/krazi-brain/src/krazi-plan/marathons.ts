import type {
  MarathonSettings,
  ProgrammingAssignment,
  RotationCheckpoint,
} from "./contracts.js";
import { type DecisionSeed, drawInRange } from "./programming-decisions.js";

/**
 * Whether channel-wide cooldown lets a marathon begin: none has started
 * yet, or enough completed ordinary rounds have passed since one did.
 * Checked when a round forms and again when its opportunity's turn starts.
 */
export function cooldownPermits(
  state: RotationCheckpoint,
  marathons: MarathonSettings,
): boolean {
  return (
    state.ordinaryRoundsSinceMarathon === null ||
    state.ordinaryRoundsSinceMarathon >= marathons.minOrdinaryRounds
  );
}

/**
 * Returns the cooldown count once a round ends. A round counts once, and
 * only when it committed a program and started no marathon; an empty or
 * entirely skipped round, and the marathon's own round, never count.
 */
export function closeRound(state: RotationCheckpoint): number | null {
  const counted =
    state.roundNumber > 0 &&
    state.roundCommittedProgram &&
    state.marathonOpportunity?.started !== true;
  return state.ordinaryRoundsSinceMarathon !== null && counted
    ? state.ordinaryRoundsSinceMarathon + 1
    : state.ordinaryRoundsSinceMarathon;
}

/**
 * Draws a new round's marathon opportunity: when cooldown permits and some
 * usable assignment has a marathon setting, one seeded chance decision for
 * the round, then one uniform pick among those assignments in saved order.
 * No roll per source and no reroll later, so the round holds at most one.
 */
export function drawOpportunity(
  round: RotationCheckpoint,
  usable: readonly ProgrammingAssignment[],
  marathons: MarathonSettings,
  seed: DecisionSeed,
): RotationCheckpoint["marathonOpportunity"] {
  const enabled = usable.filter((assignment) => assignment.marathon !== null);
  if (enabled.length === 0 || !cooldownPermits(round, marathons)) return null;
  const roll = drawInRange(
    seed,
    "marathon_chance",
    round.roundNumber,
    0,
    0,
    99,
  );
  if (roll >= marathons.chancePercent) return null;
  const pick = drawInRange(
    seed,
    "marathon_source",
    round.roundNumber,
    0,
    0,
    enabled.length - 1,
  );
  const chosen = enabled[pick];
  return chosen === undefined
    ? null
    : { assignmentId: chosen.id, started: false };
}
