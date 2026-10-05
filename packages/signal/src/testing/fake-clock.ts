import { assertNonNegativeSafeInteger } from "@krazitv/process";

import type { Clock, ScheduledTask, TimerScheduler } from "../runtime/clock.js";

type TimerRecord = {
  id: number;
  deadlineMs: number;
  callback: () => void;
  active: boolean;
};

/**
 * Time and timers that move only when a test advances them, so boundary,
 * deadline, and idle-grace behavior is deterministic.
 */
export class FakeClock implements Clock, TimerScheduler {
  private currentTimeMs: number;
  private nextTimerId = 1;
  private readonly timers = new Map<number, TimerRecord>();

  /** Rejects an inexact start time so every later comparison stays exact. */
  constructor(initialTimeMs = 0) {
    assertSafeInteger(initialTimeMs, "initialTimeMs");
    this.currentTimeMs = initialTimeMs;
  }

  /** Reads fake time; it never moves on its own. */
  now(): number {
    return this.currentTimeMs;
  }

  /** Lets leak checks prove a stopped component left no timer behind. */
  get pendingTimerCount(): number {
    return this.timers.size;
  }

  /** Schedules a callback that fires only when an advance reaches its deadline. */
  setTimeout(callback: () => void, delayMs: number): ScheduledTask {
    assertNonNegativeSafeInteger(delayMs, "delayMs");
    const deadlineMs = this.currentTimeMs + delayMs;
    assertSafeInteger(deadlineMs, "timer deadline");

    const record: TimerRecord = {
      id: this.nextTimerId++,
      deadlineMs,
      callback,
      active: true,
    };
    this.timers.set(record.id, record);

    return {
      /** Reads the live record, so a fired or cancelled timer reports inactive. */
      get active() {
        return record.active;
      },
      cancel: () => {
        if (!record.active) return;
        record.active = false;
        this.timers.delete(record.id);
      },
    };
  }

  /** Moves time forward by a duration; see `advanceTo` for firing order. */
  advanceBy(durationMs: number): void {
    assertNonNegativeSafeInteger(durationMs, "durationMs");
    this.advanceTo(this.currentTimeMs + durationMs);
  }

  /**
   * Fires due timers one at a time in deadline order, with `now` set to each
   * deadline, so a callback that schedules another timer sees real ordering.
   * Never moves backwards, matching wall-clock time.
   */
  advanceTo(targetTimeMs: number): void {
    assertSafeInteger(targetTimeMs, "targetTimeMs");
    if (targetTimeMs < this.currentTimeMs) {
      throw new RangeError("FakeClock cannot move backwards");
    }

    while (true) {
      const next = [...this.timers.values()]
        .filter((timer) => timer.active && timer.deadlineMs <= targetTimeMs)
        .sort(
          (left, right) =>
            left.deadlineMs - right.deadlineMs || left.id - right.id,
        )[0];
      if (!next) break;

      this.currentTimeMs = next.deadlineMs;
      next.active = false;
      this.timers.delete(next.id);
      next.callback();
    }

    this.currentTimeMs = targetTimeMs;
  }
}

/** Rejects a timestamp that cannot be compared exactly; timestamps may be negative. */
function assertSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer`);
  }
}
