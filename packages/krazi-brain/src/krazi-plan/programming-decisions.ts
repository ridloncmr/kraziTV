import { hash32 } from "../schedule/seeded-hash.js";

/**
 * What every kraziPlan decision hashes: the channel's persisted programming
 * seed and how many fresh rebuilds it has had, so a rebuild starts new
 * decisions while restarts and chunking replay the same ones.
 */
export interface DecisionSeed {
  programmingSeed: number;
  rebuildCount: number;
}

/**
 * The independent decision streams; each draws only from its own label, so
 * one kind of decision never advances another. Collection playback
 * randomness has its own seed and is never one of these.
 */
type DecisionStream =
  "shuffle" | "size" | "marathon_chance" | "marathon_source" | "marathon_size";

/**
 * Returns one reproducible unsigned 32-bit draw for a decision, keyed by its
 * stream, round, and index within the round. Block IDs, request order, and
 * previews are never inputs, so the same rotation state always draws the same.
 */
function decide(
  seed: DecisionSeed,
  stream: DecisionStream,
  roundNumber: number,
  index: number,
): number {
  return hash32(
    `${stream}:${seed.programmingSeed}:${seed.rebuildCount}:${roundNumber}:${index}`,
  );
}

/**
 * Draws a reproducible integer from `min` to `max` inclusive for one
 * decision. Modulo bias is accepted, as it is for random selection.
 */
export function drawInRange(
  seed: DecisionSeed,
  stream: DecisionStream,
  roundNumber: number,
  index: number,
  min: number,
  max: number,
): number {
  return min + (decide(seed, stream, roundNumber, index) % (max - min + 1));
}

/**
 * Shuffles a round's assignment IDs from saved order with a seeded
 * Fisher-Yates pass, one `shuffle` draw per position.
 */
export function shuffleRound(
  ids: readonly string[],
  seed: DecisionSeed,
  roundNumber: number,
): string[] {
  const shuffled = [...ids];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = drawInRange(seed, "shuffle", roundNumber, index, 0, index);
    const held = shuffled[index];
    shuffled[index] = shuffled[other];
    shuffled[other] = held;
  }
  return shuffled;
}
