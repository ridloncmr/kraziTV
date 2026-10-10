interface TmdbRequestQueueLimits {
  /** Requests that may be waiting on TMDB at once. */
  maxInFlight: number;
  /** Requests that may start within any one-second window. */
  perSecond: number;
}

interface Waiter {
  urgent: boolean;
  start(): void;
}

interface RunOptions {
  /** Cancelling while waiting leaves the line without running the request. */
  signal?: AbortSignal | undefined;
  /** Waits ahead of every non-urgent request, for a person waiting on the answer. */
  urgent?: boolean;
}

// The span `perSecond` counts starts over.
const WINDOW_MS = 1_000;

/**
 * Holds every TMDB request in one first-in, first-out line, so scans, retries,
 * and refresh together stay under TMDB's rate ceiling however many run. A
 * request holds its slot until it settles, and a slot opens only when both
 * the in-flight and the per-second limits allow it.
 */
export class TmdbRequestQueue {
  readonly #limits: TmdbRequestQueueLimits;
  readonly #waiting: Waiter[] = [];
  // Start times inside the current window, oldest first.
  readonly #recentStarts: number[] = [];
  #inFlight = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;

  // One instance must serve the whole process, or the limits multiply.
  constructor(limits: TmdbRequestQueueLimits) {
    this.#limits = limits;
  }

  /**
   * Runs `request` once a slot opens and returns its result. A caller
   * cancelled while waiting leaves the line without its request ever running.
   * An urgent request goes ahead of every waiting non-urgent one, so a key
   * check never waits behind a large scan, but still counts toward both limits.
   */
  async run<T>(
    request: () => Promise<T>,
    { signal, urgent = false }: RunOptions = {},
  ): Promise<T> {
    await this.#acquire(signal, urgent);
    try {
      return await request();
    } finally {
      this.#inFlight -= 1;
      this.#startWaiters();
    }
  }

  // Resolves once this caller owns a slot, or rejects with the abort reason.
  #acquire(signal: AbortSignal | undefined, urgent: boolean): Promise<void> {
    if (signal?.aborted) return Promise.reject(signal.reason as Error);
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        urgent,
        start: () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        },
      };
      const onAbort = () => {
        this.#waiting.splice(this.#waiting.indexOf(waiter), 1);
        reject(signal?.reason as Error);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      // Behind earlier urgent waiters, ahead of every non-urgent one.
      const firstNonUrgent = this.#waiting.findIndex((other) => !other.urgent);
      if (urgent && firstNonUrgent !== -1) {
        this.#waiting.splice(firstNonUrgent, 0, waiter);
      } else {
        this.#waiting.push(waiter);
      }
      this.#startWaiters();
    });
  }

  /**
   * Starts the oldest waiters while both limits allow. When only the
   * per-second limit blocks, one timer wakes the line as the oldest start
   * leaves the window.
   */
  #startWaiters(): void {
    while (
      this.#waiting.length > 0 &&
      this.#inFlight < this.#limits.maxInFlight
    ) {
      const now = Date.now();
      while ((this.#recentStarts[0] ?? now) <= now - WINDOW_MS) {
        this.#recentStarts.shift();
      }
      if (this.#recentStarts.length >= this.#limits.perSecond) {
        this.#wakeAt((this.#recentStarts[0] ?? now) + WINDOW_MS - now);
        return;
      }
      this.#recentStarts.push(now);
      this.#inFlight += 1;
      this.#waiting.shift()?.start();
    }
  }

  // Keeps at most one pending wake-up; it never holds the process open.
  #wakeAt(delayMs: number): void {
    if (this.#timer !== undefined) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#startWaiters();
    }, delayMs);
    this.#timer.unref?.();
  }
}
