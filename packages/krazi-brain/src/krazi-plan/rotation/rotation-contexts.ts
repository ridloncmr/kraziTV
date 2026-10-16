import type {
  RotationCheckpoint,
  RoundState,
  RotationScope,
} from "../contracts.js";
import {
  type DecisionSeed,
  drawInRange,
  type RoundKey,
} from "../programming-decisions.js";

/**
 * One context's round together with the channel-wide fields: the state a
 * turn is chosen from and advanced past.
 */
export type RotationState = RoundState &
  Omit<RotationCheckpoint, "activeContext" | "contexts">;

/** A context's round before its first one forms. */
const NO_ROUND: RoundState = Object.freeze({
  roundNumber: 0,
  pending: [],
  served: [],
  skipped: [],
  unservedRemoved: [],
  marathonOpportunity: null,
  roundCommittedProgram: false,
});

/** Reads one context's round, as it was last left, with the channel-wide fields. */
export function enterContext(
  checkpoint: RotationCheckpoint,
  contextKey: string,
): RotationState {
  const { activeContext: _, contexts, ...channelWide } = checkpoint;
  return { ...(contexts[contextKey] ?? NO_ROUND), ...channelWide };
}

/**
 * Stores a context's round back into the checkpoint as the active one,
 * leaving every other context's round as it was.
 */
export function leaveContext(
  state: RotationState,
  contextKey: string,
  checkpoint: RotationCheckpoint,
): RotationCheckpoint {
  const {
    roundNumber,
    pending,
    served,
    skipped,
    unservedRemoved,
    marathonOpportunity,
    roundCommittedProgram,
    ...channelWide
  } = state;
  return {
    activeContext: contextKey,
    contexts: {
      ...checkpoint.contexts,
      [contextKey]: {
        roundNumber,
        pending,
        served,
        skipped,
        unservedRemoved,
        marathonOpportunity,
        roundCommittedProgram,
      },
    },
    ...channelWide,
  };
}

/**
 * Brings a round under way in line with who is eligible now (programming
 * spec 0005): a pending assignment that lost eligibility leaves the round
 * but is remembered, and one the winning rule makes eligible, or that was
 * remembered, enters the remaining turns at a seeded position without
 * reordering them. A served or skipped assignment never gets another turn,
 * and a default assignment added mid-round waits for the next. A round with
 * no turns left takes no one; the next round forms from everyone eligible.
 */
export function reconcileRound(
  round: RotationState,
  scope: RotationScope,
  seed: DecisionSeed,
  key: RoundKey,
): RotationState {
  const eligible = new Set(scope.eligible.map(({ id }) => id));
  const removed = round.pending.filter((id) => !eligible.has(id));
  const pending = round.pending.filter((id) => eligible.has(id));
  const unservedRemoved = [...round.unservedRemoved, ...removed];
  if (pending.length === 0) {
    return { ...round, pending, unservedRemoved };
  }
  const settled = new Set([...pending, ...round.served, ...round.skipped]);
  for (const { id } of scope.eligible) {
    if (settled.has(id)) continue;
    if (!scope.ruleDriven.has(id) && !unservedRemoved.includes(id)) continue;
    pending.splice(
      drawInRange(seed, "join", key, id, 0, pending.length),
      0,
      id,
    );
  }
  return {
    ...round,
    pending,
    unservedRemoved: unservedRemoved.filter((id) => !pending.includes(id)),
  };
}
