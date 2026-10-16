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
  | "shuffle"
  | "size"
  | "marathon_chance"
  | "marathon_source"
  | "marathon_size"
  | "join";

/**
 * Names one context's round in decision keys. The default context keeps the
 * bare round number, so channels without feature rules draw exactly as they
 * did before rules existed; a feature context's rounds draw apart from it.
 */
export type RoundKey = number | string;

/** The decision key of a round in a rotation context. */
export function roundKey(contextKey: string, roundNumber: number): RoundKey {
  return contextKey === "default"
    ? roundNumber
    : `${contextKey}/${roundNumber}`;
}

/**
 * Returns one reproducible unsigned 32-bit draw for a decision, keyed by its
 * stream, round, and index within the round. Block IDs, request order, and
 * previews are never inputs, so the same rotation state always draws the same.
 */
function decide(
  seed: DecisionSeed,
  stream: DecisionStream,
  round: RoundKey,
  index: number | string,
): number {
  return hash32(
    `${stream}:${seed.programmingSeed}:${seed.rebuildCount}:${round}:${index}`,
  );
}

/**
 * Draws a reproducible integer from `min` to `max` inclusive for one
 * decision. Modulo bias is accepted, as it is for random selection.
 */
export function drawInRange(
  seed: DecisionSeed,
  stream: DecisionStream,
  round: RoundKey,
  index: number | string,
  min: number,
  max: number,
): number {
  return min + (decide(seed, stream, round, index) % (max - min + 1));
}

/**
 * Shuffles a round's assignment IDs from saved order with a seeded
 * Fisher-Yates pass, one `shuffle` draw per position.
 */
export function shuffleRound(
  ids: readonly string[],
  seed: DecisionSeed,
  round: RoundKey,
): string[] {
  const shuffled = [...ids];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = drawInRange(seed, "shuffle", round, index, 0, index);
    const held = shuffled[index];
    shuffled[index] = shuffled[other];
    shuffled[other] = held;
  }
  return shuffled;
}
