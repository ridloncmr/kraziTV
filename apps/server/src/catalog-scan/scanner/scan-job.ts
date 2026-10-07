import type { ScanStatus, ScanSummary } from "../contracts.js";

/**
 * The scanner's mutable record of one scan job. Only the job's own run
 * changes `status`, except that cancellation sets `cancelRequested`; readers
 * get copies, never this record.
 */
export interface ScanJob {
  readonly status: ScanStatus;
  readonly controller: AbortController;
  /** Settles once the job is terminal; never rejects. */
  done: Promise<void>;
}

/** How a job's run ended; the terminal phase plus its one payload. */
export type ScanOutcome =
  | { phase: "completed"; summary: ScanSummary }
  | { phase: "cancelled" }
  | { phase: "failed"; error: NonNullable<ScanStatus["error"]> };

/** True while the job can still change; at most one such job per root. */
export function isRunning(status: ScanStatus): boolean {
  return (
    status.phase === "discovering" ||
    status.phase === "probing" ||
    status.phase === "committing"
  );
}

/** True only in the phases cancellation can still stop; committing ignores it. */
export function isCancellable(status: ScanStatus): boolean {
  return status.phase === "discovering" || status.phase === "probing";
}

/** A copy for readers, so nothing outside the scanner can change a job. */
export function snapshot(status: ScanStatus): ScanStatus {
  return { ...status };
}

/** Moves a job to its terminal phase in one step, clearing probing-only state. */
export function finishJob(
  status: ScanStatus,
  outcome: ScanOutcome,
  finishedAt: number,
): void {
  status.phase = outcome.phase;
  status.finishedAt = finishedAt;
  status.currentPath = null;
  if (outcome.phase === "completed") status.summary = outcome.summary;
  if (outcome.phase === "failed") status.error = outcome.error;
}

// Builds a failed outcome; the message is shown to the operator as-is.
export function failed(
  code: NonNullable<ScanStatus["error"]>["code"],
  message: string,
): ScanOutcome {
  return { phase: "failed", error: { code, message } };
}
