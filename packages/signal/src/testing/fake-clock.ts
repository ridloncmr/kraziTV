import type { Clock, ScheduledTask, TimerScheduler } from "../contracts.js";

type TimerRecord = {
  id: number;
  deadlineMs: number;
  callback: () => void;
  active: boolean;
};

export class FakeClock implements Clock, TimerScheduler {
  private currentTimeMs: number;
  private nextTimerId = 1;
  private readonly timers = new Map<number, TimerRecord>();

  constructor(initialTimeMs = 0) {
    assertSafeInteger(initialTimeMs, "initialTimeMs");
    this.currentTimeMs = initialTimeMs;
  }

  now(): number {
    return this.currentTimeMs;
  }

  get pendingTimerCount(): number {
    return this.timers.size;
  }

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

  advanceBy(durationMs: number): void {
    assertNonNegativeSafeInteger(durationMs, "durationMs");
    this.advanceTo(this.currentTimeMs + durationMs);
  }

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

function assertSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer`);
  }
}

function assertNonNegativeSafeInteger(value: number, name: string): void {
  assertSafeInteger(value, name);
  if (value < 0) throw new RangeError(`${name} must be non-negative`);
}
