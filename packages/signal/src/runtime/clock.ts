/** UTC Unix epoch milliseconds. */
export type TimestampMs = number;
/** An integer duration in milliseconds, constrained by its use. */
export type DurationMs = number;

export interface Clock {
  now(): TimestampMs;
}

export interface ScheduledTask {
  readonly active: boolean;
  cancel(): void;
}

export interface TimerScheduler {
  setTimeout(callback: () => void, delayMs: DurationMs): ScheduledTask;
}
