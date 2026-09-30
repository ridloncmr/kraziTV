import {
  MediaProbeError,
  type MediaProbeOptions,
  type MediaProbeResult,
  type MediaProber,
} from "@krazitv/media";

interface QueuedProbe {
  start(): void;
}

/**
 * Enforces one process-wide ffprobe budget shared by every scan. A slot is held
 * until the wrapped probe settles, and the media adapter settles only after its
 * child has closed, so a terminating child still counts against the limit.
 */
export class ConcurrencyLimitedProber implements MediaProber {
  readonly #prober: MediaProber;
  readonly #limit: number;
  readonly #queue: QueuedProbe[] = [];
  #active = 0;

  // The limit is validated configuration; one instance must serve the whole process.
  constructor(prober: MediaProber, limit: number) {
    this.#prober = prober;
    this.#limit = limit;
  }

  /** Waits in FIFO order for a slot; a cancelled waiter leaves without probing. */
  async probe(
    path: string,
    options: MediaProbeOptions = {},
  ): Promise<MediaProbeResult> {
    await this.#acquire(options.signal);
    try {
      return await this.#prober.probe(path, options);
    } finally {
      this.#release();
    }
  }

  // Resolves once this caller owns a slot, or rejects if cancelled while waiting.
  #acquire(signal: AbortSignal | undefined): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(cancelledWhileQueued());
    }
    if (this.#active < this.#limit) {
      this.#active += 1;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const entry: QueuedProbe = {
        start: () => {
          signal?.removeEventListener("abort", onAbort);
          this.#active += 1;
          resolve();
        },
      };
      const onAbort = () => {
        this.#queue.splice(this.#queue.indexOf(entry), 1);
        reject(cancelledWhileQueued());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#queue.push(entry);
    });
  }

  // Hands the freed slot to the oldest waiter, if any.
  #release(): void {
    this.#active -= 1;
    this.#queue.shift()?.start();
  }
}

// Matches the adapter's cancellation code so callers see one failure shape.
function cancelledWhileQueued(): MediaProbeError {
  return new MediaProbeError(
    "cancelled",
    "ffprobe was cancelled before it started",
  );
}
