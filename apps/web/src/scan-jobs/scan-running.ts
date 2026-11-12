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
