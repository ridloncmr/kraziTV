import type { DesktopWindow, ProgramId } from "../contracts.js";

// Desktop shell state only: where this browser last left each program's
// window. It never reaches the server and never decides what airs.
const STORAGE_KEY = "krazitv.windows";

/** The placement a program's window reopens at: where it was, how big, and whether it was maximized. */
export type WindowPlacement = Pick<
  DesktopWindow,
  "x" | "y" | "width" | "height" | "maximized"
>;

/** What this browser remembers, by program; a program never opened here has no entry. */
export type WindowMemory = Partial<Record<ProgramId, WindowPlacement>>;

/** Whether a stored value is a placement, so a stale or edited entry opens at the default instead of somewhere off screen. */
function isPlacement(value: unknown): value is WindowPlacement {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    ["x", "y", "width", "height"].every(
      (key) => typeof record[key] === "number" && Number.isFinite(record[key]),
    ) && typeof record.maximized === "boolean"
  );
}

/** Reads what this browser remembers; missing, unreadable, or blocked storage counts as nothing. */
export function readWindowMemory(): WindowMemory {
  try {
    const value = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "null",
    ) as unknown;
    if (typeof value !== "object" || value === null) return {};
    return Object.fromEntries(
      Object.entries(value).filter(([, placement]) => isPlacement(placement)),
    );
  } catch {
    /* Unreadable memory just means windows open at their defaults. */
    return {};
  }
}

/**
 * Records where the open windows are over what was remembered, so a closed
 * program keeps its last placement, and stores the result. Blocked storage
 * only means the next visit starts from the defaults again.
 */
export function rememberWindows(
  memory: WindowMemory,
  windows: readonly DesktopWindow[],
): WindowMemory {
  const next: WindowMemory = { ...memory };
  for (const { id, x, y, width, height, maximized } of windows) {
    next[id] = { x, y, width, height, maximized };
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* Private windows may refuse storage. */
  }
  return next;
}
