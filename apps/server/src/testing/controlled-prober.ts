// Test-only MediaProber whose probes settle when the test says so.
import {
  MediaProbeError,
  type MediaProbeOptions,
  type MediaProbeResult,
  type MediaProber,
} from "@krazitv/media";

export interface PendingProbe {
  path: string;
  signal: AbortSignal | undefined;
  settled: boolean;
  resolve(result: MediaProbeResult): void;
  reject(error: unknown): void;
}

/**
 * Records every probe call and leaves it pending, so tests can observe queueing,
 * concurrency, and cancellation, then settle probes in any order they choose.
 */
export class ControlledProber implements MediaProber {
  readonly started: PendingProbe[] = [];
  active = 0;
  maxActive = 0;
  #waiters: Array<{ count: number; resolve(): void }> = [];

  /** Starts a pending probe; it settles only when the test resolves or rejects it. */
  probe(
    path: string,
    options: MediaProbeOptions = {},
  ): Promise<MediaProbeResult> {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    return new Promise<MediaProbeResult>((resolve, reject) => {
      const pending: PendingProbe = {
        path,
        signal: options.signal,
        settled: false,
        resolve: (result) => {
          if (this.#settle(pending)) resolve(result);
        },
        reject: (error) => {
          if (this.#settle(pending)) reject(error);
        },
      };
      this.started.push(pending);
      this.#notify();
    });
  }

  /** Settles every still-pending probe with the same successful result. */
  resolveAll(result: MediaProbeResult): void {
    for (const probe of this.started) probe.resolve(result);
  }

  /** Resolves once at least `count` probes have started. */
  async waitForStarted(count: number): Promise<void> {
    if (this.started.length >= count) return;
    await new Promise<void>((resolve) => {
      this.#waiters.push({ count, resolve });
    });
  }

  /** Finds the pending probe for a path so tests can settle it explicitly. */
  get(path: string): PendingProbe {
    const probe = this.started.find((candidate) => candidate.path === path);
    if (!probe) throw new Error(`No probe started for ${path}`);
    return probe;
  }

  /** Behaves like the real adapter: settles a cancelled probe only when asked. */
  rejectCancelled(path: string): void {
    this.get(path).reject(
      new MediaProbeError("cancelled", "ffprobe was cancelled"),
    );
  }

  // Makes repeated settlement harmless so the active count stays truthful.
  #settle(probe: PendingProbe): boolean {
    if (probe.settled) return false;
    probe.settled = true;
    this.active -= 1;
    return true;
  }

  // Wakes waiters whose requested start count has been reached.
  #notify(): void {
    this.#waiters = this.#waiters.filter((waiter) => {
      if (this.started.length < waiter.count) return true;
      waiter.resolve();
      return false;
    });
  }
}
