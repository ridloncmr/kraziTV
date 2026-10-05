import { setMaxListeners } from "node:events";

import {
  discoverMediaFiles,
  MediaDiscoveryError,
  MediaProbeError,
  type DiscoveredMediaFile,
  type DiscoverMediaFilesOptions,
  type MediaProber,
} from "@krazitv/media";

import type { MediaRoot } from "../../media-roots/contracts.js";
import type { MediaRootRepository } from "../../media-roots/media-root-repository.js";
import {
  createCatalogCandidate,
  validateCatalogCandidate,
  type ProbeOutcome,
} from "./catalog-candidate.js";
import type { CatalogScanWriter } from "../writer/catalog-scan-writer.js";
import { admitRoot } from "../root-admission.js";
import type { ScanResult } from "../contracts.js";

interface ScanOptions {
  /** Aborts the scan, e.g. when the requesting client disconnects. */
  signal?: AbortSignal;
}

interface CatalogScannerOptions {
  roots: Pick<MediaRootRepository, "findById">;
  /** Must be the process-wide concurrency-limited prober. */
  prober: MediaProber;
  writer: CatalogScanWriter;
  discover?: (
    rootPath: string,
    options?: DiscoverMediaFilesOptions,
  ) => Promise<DiscoveredMediaFile[]>;
  now?: () => number;
}

interface ActiveScan {
  controller: AbortController;
  done: Promise<unknown>;
}

/**
 * Composes one root's scan as discover -> probe -> candidate -> validate ->
 * commit. Discovery and probing are persistence-free; only the writer touches
 * the database, once, after every probe has settled.
 */
export class CatalogScanner {
  readonly #roots: CatalogScannerOptions["roots"];
  readonly #prober: MediaProber;
  readonly #writer: CatalogScanWriter;
  readonly #discover: NonNullable<CatalogScannerOptions["discover"]>;
  readonly #now: () => number;
  // Process-local, matching the single-process MVP; the final transaction stays the correctness boundary.
  readonly #active = new Map<string, ActiveScan>();
  #closing = false;

  // Discovery and the clock are injectable so tests control traversal and timestamps.
  constructor(options: CatalogScannerOptions) {
    this.#roots = options.roots;
    this.#prober = options.prober;
    this.#writer = options.writer;
    this.#discover = options.discover ?? discoverMediaFiles;
    this.#now = options.now ?? Date.now;
  }

  /** Scans one root, rejecting disabled roots and overlapping scans of the same root. */
  async scan(rootId: string, options: ScanOptions = {}): Promise<ScanResult> {
    const found = await this.#roots.findById(rootId);
    if (this.#closing) {
      return { kind: "cancelled" };
    }
    const admission = admitRoot(found);
    if (admission.kind !== "admitted") {
      return admission;
    }
    const { root } = admission;
    if (this.#active.has(rootId)) {
      return { kind: "scan_in_progress" };
    }

    // Registered synchronously after the check so two requests cannot both pass it.
    const controller = new AbortController();
    const signal =
      options.signal === undefined
        ? controller.signal
        : AbortSignal.any([options.signal, controller.signal]);
    const done = this.#run(root, signal);
    this.#active.set(rootId, { controller, done });
    try {
      return await done;
    } finally {
      this.#active.delete(rootId);
    }
  }

  /**
   * Cancels every active scan and waits until each has settled, which includes
   * every ffprobe child closing, so the database can be closed safely afterwards.
   */
  async shutdown(): Promise<void> {
    this.#closing = true;
    const scans = [...this.#active.values()];
    for (const scan of scans) {
      scan.controller.abort();
    }
    await Promise.allSettled(scans.map((scan) => scan.done));
  }

  // Runs every stage in order; each stage observes the same cancellation signal.
  async #run(root: MediaRoot, signal: AbortSignal): Promise<ScanResult> {
    const startedAt = this.#now();
    if (signal.aborted) {
      return { kind: "cancelled" };
    }

    let files: DiscoveredMediaFile[];
    try {
      files = await this.#discover(root.path, { signal });
    } catch (error) {
      if (signal.aborted) {
        return { kind: "cancelled" };
      }
      if (error instanceof MediaDiscoveryError) {
        return { kind: "root_unavailable", error };
      }
      throw error;
    }

    const outcomes = await this.#probeAll(files, signal);
    if (outcomes === undefined) {
      return { kind: "cancelled" };
    }

    // Outcomes are indexed like `files`, so identity order survives out-of-order probes.
    const candidates = files.map((file, index) =>
      createCatalogCandidate(file, outcomes[index]),
    );
    // Future metadata enrichment transforms `candidates` here, before validation.
    candidates.forEach(validateCatalogCandidate);

    const completedAt = this.#now();
    const commit = await this.#writer.commit(
      { rootId: root.id, scannedAt: completedAt, candidates },
      signal,
    );
    if (commit.kind !== "committed") {
      return commit;
    }

    const probedCount = outcomes.filter(
      (outcome) => outcome.kind === "probed",
    ).length;
    return {
      kind: "completed",
      summary: {
        rootId: root.id,
        startedAt,
        completedAt,
        discoveredCount: files.length,
        probedCount,
        probeFailedCount: files.length - probedCount,
        missingCount: commit.missingCount,
      },
    };
  }

  /**
   * Probes every file through the shared limit. Item-level probe failures are
   * staged; cancellation returns undefined and an unexpected error is rethrown,
   * both only after every started probe has settled and its child has closed.
   */
  async #probeAll(
    files: readonly DiscoveredMediaFile[],
    signal: AbortSignal,
  ): Promise<ProbeOutcome[] | undefined> {
    const stop = new AbortController();
    // Every queued or running probe listens on this one signal by design, so
    // Node's default 10-listener leak warning would fire on any real library.
    setMaxListeners(0, stop.signal);
    const onAbort = () => stop.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) stop.abort();

    let fatal: { error: unknown } | undefined;
    const outcomes = await Promise.all(
      files.map(async (file): Promise<ProbeOutcome | undefined> => {
        try {
          const result = await this.#prober.probe(file.path, {
            signal: stop.signal,
          });
          return { kind: "probed", probedAt: this.#now(), result };
        } catch (error) {
          if (error instanceof MediaProbeError && !stop.signal.aborted) {
            return { kind: "failed", probedAt: this.#now(), error };
          }
          if (!stop.signal.aborted) {
            fatal = { error };
            stop.abort();
          }
          return undefined;
        }
      }),
    );
    signal.removeEventListener("abort", onAbort);

    if (fatal !== undefined) {
      throw fatal.error;
    }
    if (signal.aborted) {
      return undefined;
    }
    return outcomes as ProbeOutcome[];
  }
}
