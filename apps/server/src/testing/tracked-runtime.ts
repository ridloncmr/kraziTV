// Test-only wall-clock runtime that remembers every timer it schedules.
import {
  SystemRuntime,
  type Clock,
  type ScheduledTask,
  type TimerScheduler,
} from "@krazitv/signal";

/**
 * Real time and real timers, plus a count of tasks still pending, so an
 * end-to-end suite can treat a timer left behind by a stopped worker or
 * FFmpeg process as a leak.
 */
export class TrackedRuntime implements Clock, TimerScheduler {
  readonly #system = new SystemRuntime();
  readonly #tasks: ScheduledTask[] = [];

  /** Reads wall-clock time, as the production runtime does. */
  now(): number {
    return this.#system.now();
  }

  /** Schedules a native timer and keeps its handle for the leak check. */
  setTimeout(callback: () => void, delayMs: number): ScheduledTask {
    const task = this.#system.setTimeout(callback, delayMs);
    this.#tasks.push(task);
    return task;
  }

  /** Counts timers that have neither fired nor been cancelled. */
  get pendingTimerCount(): number {
    return this.#tasks.filter((task) => task.active).length;
  }
}
