export interface TestBarrier {
  /** Resolves once the paused side has reached `wait()`. */
  readonly reached: Promise<void>;
  /** Called by the paused side; resolves only after `release()`. */
  wait(): Promise<void>;
  /** Lets the paused side continue. */
  release(): void;
}

/**
 * Pauses one side of a concurrency test at a known point, so the test can
 * interleave the other side deterministically instead of sleeping.
 */
export function createBarrier(): TestBarrier {
  let markReached!: () => void;
  let release!: () => void;
  const reached = new Promise<void>((resolve) => (markReached = resolve));
  const released = new Promise<void>((resolve) => (release = resolve));

  return {
    reached,
    wait() {
      markReached();
      return released;
    },
    release,
  };
}
