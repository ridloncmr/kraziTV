/** Waits `turns` microtask turns without letting timers or I/O run. */
export async function flushMicrotasks(turns: number): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
}
