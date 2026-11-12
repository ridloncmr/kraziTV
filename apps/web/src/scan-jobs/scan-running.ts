import type { MediaRoot } from "../http/contracts/media.js";
import type { ScanStatus } from "../http/contracts/scan.js";

/** The phases after which a scan job never changes again. */
const TERMINAL_PHASES: ReadonlySet<ScanStatus["phase"]> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

/**
 * A running job still changes on the server, so Media Library's progress
 * dialog keeps polling and stays busy, and the shell's tray keeps following
 * it.
 */
export function isScanRunning(status: ScanStatus): boolean {
  return !TERMINAL_PHASES.has(status.phase);
}

/**
 * Whether any root's scan or lookup still runs, so the shell keeps polling
 * the roots and the tray waits for the library to settle before counting
 * what is left to look up.
 */
export function anyRootJobRunning(roots: readonly MediaRoot[]): boolean {
  return roots.some((root) => root.scan !== null && isScanRunning(root.scan));
}
