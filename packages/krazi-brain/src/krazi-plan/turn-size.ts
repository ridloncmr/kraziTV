import type { TurnSize } from "../schedule/contracts.js";
import type {
  AssignmentMember,
  LatestTurn,
  ResolvedSize,
  StretchSetting,
} from "./contracts.js";

const MINUTE_MS = 60_000;

/**
 * Resolves the size a new turn records on its block. A single item airs
 * once, whole, and ignores the stretch setting, so it records none.
 */
export function resolveSize(
  member: AssignmentMember,
  stretch: StretchSetting,
): ResolvedSize | null {
  if (member.kind === "media_item") return null;
  return { kind: "programs", value: stretch.count };
}

/**
 * Converts a block's recorded size into the turn generation runs, counting
 * what already aired, so a turn retained across chunks, restarts, and
 * regeneration continues rather than starting over. A single-item turn is
 * one program.
 */
export function turnSize(
  size: ResolvedSize | null,
  aired: Pick<LatestTurn, "airedPrograms" | "airedMs"> = {
    airedPrograms: 0,
    airedMs: 0,
  },
): TurnSize {
  if (size?.kind === "airtime") {
    return {
      kind: "airtime",
      target: size.value * MINUTE_MS,
      accumulated: aired.airedMs,
    };
  }
  return {
    kind: "programs",
    target: size?.value ?? 1,
    accumulated: aired.airedPrograms,
  };
}
