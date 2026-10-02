/**
 * Holds one cleanup attempt, such as a stop or shutdown, that concurrent
 * callers share. A successful attempt stays held, so later calls resolve at
 * once; a failed one is released so the next call retries.
 */
export class RetryableAttempt {
  private current: Promise<void> | undefined;

  /** Returns the held attempt, starting a new one only when none is held. */
  run(start: () => Promise<void>): Promise<void> {
    if (this.current !== undefined) return this.current;

    const attempt = start();
    this.current = attempt;
    void attempt.catch(() => {
      if (this.current === attempt) this.current = undefined;
    });
    return attempt;
  }
}
