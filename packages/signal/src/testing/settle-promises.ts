/**
 * Waits `turns` event-loop turns so promise chains and stream events queued
 * behind I/O callbacks can run. Tests pick the turn count their deepest
 * chain needs.
 */
export async function settlePromises(turns = 1): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/** Waits `turns` microtask turns without letting timers or I/O run. */
export async function flushMicrotasks(turns: number): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
}
