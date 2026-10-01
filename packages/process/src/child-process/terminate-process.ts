import type { ProcessTimerScheduler, SpawnedProcess } from "./contracts.js";

export type TerminationOptions = {
  /** How long each signal gets to close the child before the next step. */
  graceMs: number;
  /** Defaults to Node's global timers. */
  timers?: ProcessTimerScheduler;
};

/** Whether closure was observed; when not, the last error a signal request threw. */
export type TerminationResult =
  { closed: true } | { closed: false; cause: unknown };

const nodeTimers: ProcessTimerScheduler = {
  /** Wraps the global timer so fake timers installed by tests still apply. */
  setTimeout(callback, delayMs) {
    const handle = setTimeout(callback, delayMs);
    return { cancel: () => clearTimeout(handle) };
  },
};

/**
 * Requests SIGTERM, escalates once to SIGKILL after the grace period, and
 * reports whether the child closed within a second grace period. Never
 * rejects: a failed signal delivery is covered by escalation or reported as
 * the cause, so callers decide what an unverified termination means.
 */
export async function terminateProcess(
  child: SpawnedProcess,
  { graceMs, timers = nodeTimers }: TerminationOptions,
): Promise<TerminationResult> {
  let cause: unknown;
  for (const signal of ["SIGTERM", "SIGKILL"] as const) {
    try {
      child.terminate(signal);
    } catch (error) {
      cause = error;
    }
    if (await closesWithin(child, graceMs, timers)) return { closed: true };
  }
  return { closed: false, cause };
}

/** Races observed closure against one deadline; a spawn failure counts as closed. */
function closesWithin(
  child: SpawnedProcess,
  graceMs: number,
  timers: ProcessTimerScheduler,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (closed: boolean): void => {
      if (settled) return;
      settled = true;
      deadline.cancel();
      resolve(closed);
    };
    const deadline = timers.setTimeout(() => finish(false), graceMs);

    void child.exited.then(
      () => finish(true),
      () => finish(true),
    );
  });
}
