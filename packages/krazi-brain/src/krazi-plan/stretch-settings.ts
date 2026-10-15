import type {
  AssignmentMember,
  ResolvedSize,
  StretchSetting,
} from "./contracts.js";
import { type DecisionSeed, drawInRange } from "./programming-decisions.js";

/**
 * Returns why a stretch setting is invalid, or null when it is valid: every
 * count and minute value a positive integer, and a range's maximum at least
 * its minimum. The one stretch rule, so the API asks it rather than
 * restating it.
 */
export function findStretchProblem(stretch: StretchSetting): string | null {
  const values: [string, number][] =
    stretch.kind === "programs"
      ? [["count", stretch.count]]
      : stretch.kind === "airtime"
        ? [["minutes", stretch.minutes]]
        : [
            ["minMinutes", stretch.minMinutes],
            ["maxMinutes", stretch.maxMinutes],
          ];
  for (const [name, value] of values) {
    if (!Number.isSafeInteger(value) || value < 1) {
      return `${name} must be a positive integer`;
    }
  }
  if (
    stretch.kind === "airtime_range" &&
    stretch.maxMinutes < stretch.minMinutes
  ) {
    return "maxMinutes must be at least minMinutes";
  }
  return null;
}

/** Identifies the turn a size decision belongs to. */
interface TurnPosition {
  roundNumber: number;
  turnIndex: number;
}

/**
 * Resolves the size a new turn records on its block, once, at turn start.
 * A range draws its target uniformly from its inclusive bounds on the
 * `size` stream, so equal bounds act as a fixed target and the draw never
 * touches collection playback randomness. A single item airs once, whole,
 * and ignores the stretch setting, so it records none.
 */
export function resolveSize(
  member: AssignmentMember,
  stretch: StretchSetting,
  seed: DecisionSeed,
  { roundNumber, turnIndex }: TurnPosition,
): ResolvedSize | null {
  if (member.kind === "media_item") return null;
  switch (stretch.kind) {
    case "programs":
      return { kind: "programs", value: stretch.count };
    case "airtime":
      return { kind: "airtime", value: stretch.minutes };
    case "airtime_range":
      return {
        kind: "airtime",
        value: drawInRange(
          seed,
          "size",
          roundNumber,
          turnIndex,
          stretch.minMinutes,
          stretch.maxMinutes,
        ),
      };
  }
}
