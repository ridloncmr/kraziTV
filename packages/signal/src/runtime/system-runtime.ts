import type { Clock, ScheduledTask, TimerScheduler } from "./clock.js";

/** The production clock and timers: wall-clock time and native timeouts. */
export class SystemRuntime implements Clock, TimerScheduler {
  /** Keeps schedule evaluation anchored to Unix epoch milliseconds. */
  now(): number {
    return Date.now();
  }

  /** Makes native timers explicitly cancellable for runtime cleanup. */
  setTimeout(callback: () => void, delayMs: number): ScheduledTask {
    let active = true;
    const timeout = globalThis.setTimeout(() => {
      active = false;
      callback();
    }, delayMs);
    return {
      /** Reads live state, so a fired or cancelled task reports inactive. */
      get active() {
        return active;
      },
      cancel: () => {
        if (!active) return;
        active = false;
        globalThis.clearTimeout(timeout);
      },
    };
  }
}
