export interface ManualClock {
  /** Reads the current time; pass it wherever a `now` source is expected. */
  readonly now: () => number;
  /** Jumps to an exact time, forward or backward. */
  set(time: number): void;
  /** Moves the time by `ms`, which may be negative. */
  advance(ms: number): void;
}

/**
 * Returns a clock that holds still until the test moves it, so a test can
 * read the same time any number of times and then step it deliberately.
 */
export function manualClock(start: number): ManualClock {
  let current = start;
  return {
    now: () => current,
    set(time) {
      current = time;
    },
    advance(ms) {
      current += ms;
    },
  };
}
