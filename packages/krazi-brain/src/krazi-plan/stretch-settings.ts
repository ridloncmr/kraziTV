import type {
  AssignmentMember,
  ResolvedSize,
  StretchSetting,
} from "./contracts.js";
import { type DecisionSeed, drawInRange } from "./programming-decisions.js";

/**
 * Returns why an assignment's stretch settings are invalid, or null when
 * they are valid: every count and minute value a positive integer, a
 * range's maximum at least its minimum, and a marathon in the ordinary
 * stretch's unit whose fixed size or range minimum exceeds the ordinary
 * fixed size or range maximum, so it is always a longer turn. The one
 * stretch rule, so the API asks it rather than restating it.
 */
export function findStretchProblem(
  ordinary: StretchSetting,
  marathon: StretchSetting | null = null,
): string | null {
  const problem = findShapeProblem(ordinary);
  if (problem !== null || marathon === null) return problem;
  const marathonProblem = findShapeProblem(marathon);
  if (marathonProblem !== null) return `marathon ${marathonProblem}`;
  if ((ordinary.kind === "programs") !== (marathon.kind === "programs")) {
    return "a marathon must use the ordinary stretch's unit: programs extend programs, airtime extends airtime";
  }
  return longest(ordinary) < shortest(marathon)
    ? null
    : "a marathon must be longer than the ordinary stretch";
}

/** The smallest size a stretch can resolve to. */
function shortest(stretch: StretchSetting): number {
  return stretch.kind === "programs"
    ? stretch.count
    : stretch.kind === "airtime"
      ? stretch.minutes
      : stretch.minMinutes;
}

/** The largest size a stretch can resolve to. */
function longest(stretch: StretchSetting): number {
  return stretch.kind === "airtime_range"
    ? stretch.maxMinutes
    : shortest(stretch);
}

/** Returns why one stretch's own values are invalid, or null. */
function findShapeProblem(stretch: StretchSetting): string | null {
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
 * A range draws its target uniformly from its inclusive bounds on its own
 * stream, `size` or `marathon_size`, so equal bounds act as a fixed
 * target and the draw never touches collection playback randomness. A single item airs once, whole,
 * and ignores the stretch setting, so it records none.
 */
export function resolveSize(
  member: AssignmentMember,
  stretch: StretchSetting,
  stream: "size" | "marathon_size",
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
          stream,
          roundNumber,
          turnIndex,
          stretch.minMinutes,
          stretch.maxMinutes,
        ),
      };
  }
}
