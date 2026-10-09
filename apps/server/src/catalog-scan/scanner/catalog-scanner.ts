import { randomUUID } from "node:crypto";
import { setMaxListeners } from "node:events";

import {
  discoverMediaFiles,
  MediaDiscoveryError,
  MediaProbeError,
  type DiscoveredMediaFile,
  type DiscoverMediaFilesOptions,
  type MediaProber,
  type TmdbClient,
} from "@krazitv/media";
import type { FastifyBaseLogger } from "fastify";

import type { CatalogRemovalService } from "../../catalog-removal/catalog-removal-service.js";
import type { MetadataMatchRepository } from "../../content-metadata/persistence/metadata-match-repository.js";
import type { TmdbKeyService } from "../../content-metadata/tmdb-key/tmdb-key-service.js";
import type { MediaRoot } from "../../media-roots/contracts.js";
import type { MediaRootRepository } from "../../media-roots/media-root-repository.js";
import type { ScheduleService } from "../../schedules/schedule-service.js";
import {
  createCatalogCandidate,
  pathHintsBelow,
  validateCatalogCandidate,
  type ProbeOutcome,
} from "./catalog-candidate.js";
import { countLookups, enrichCandidates } from "./enrich-candidates.js";
import type { CatalogScanWriter } from "../writer/catalog-scan-writer.js";
import { admitRoot } from "../root-admission.js";
import type { ScanStart, ScanStatus } from "../contracts.js";
import {
  failed,
  finishJob,
  isCancellable,
  isRunning,
  snapshot,
  type ScanJob,
  type ScanOutcome,
} from "./scan-job.js";

interface CatalogScannerOptions {
  roots: Pick<MediaRootRepository, "findById">;
  /** Must be the process-wide concurrency-limited prober. */
  prober: MediaProber;
  writer: Pick<CatalogScanWriter, "commit">;
  /** Runs after every completed commit, because a scan may make a channel schedulable. */
  schedules: Pick<ScheduleService, "ensureAllEnabled">;
  /** Purges removed media after every completed commit, before the schedule pass. */
  removals: Pick<CatalogRemovalService, "purge">;
  /** Where enrichment reads the owner's key and which items are settled. */
  metadata: {
    tmdbKeys: Pick<TmdbKeyService, "readKey">;
    metadataMatches: Pick<MetadataMatchRepository, "findSettledPathKeys">;
    /** Must be the process's one TMDB client, whose queue every lookup shares. */
    tmdb: TmdbClient;
  };
  /** The process logger; a job outlives the request that started it. */
  log: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  discover?: (
    rootPath: string,
    options?: DiscoverMediaFilesOptions,
  ) => Promise<DiscoveredMediaFile[]>;
  now?: () => number;
}

/**
 * Runs each root's scan as a background scan job: discover -> probe ->
 * candidate -> enrich -> validate -> commit -> schedule pass. Discovery,
 * probing, and TMDB lookups are persistence-free; only the writer touches
 * the database, once, after every probe and lookup has settled. Holds at
 * most one running job per root, and each root's latest terminal job until
 * that root's next scan.
 */
export class CatalogScanner {
  readonly #roots: CatalogScannerOptions["roots"];
  readonly #prober: MediaProber;
  readonly #writer: CatalogScannerOptions["writer"];
  readonly #schedules: CatalogScannerOptions["schedules"];
  readonly #removals: CatalogScannerOptions["removals"];
  readonly #metadata: CatalogScannerOptions["metadata"];
  readonly #log: CatalogScannerOptions["log"];
  readonly #discover: NonNullable<CatalogScannerOptions["discover"]>;
  readonly #now: () => number;
  // Process-local, matching the single-process MVP; the final transaction stays the correctness boundary.
  readonly #jobs = new Map<string, ScanJob>();
  #closing = false;

  // Discovery and the clock are injectable so tests control traversal and timestamps.
  constructor(options: CatalogScannerOptions) {
    this.#roots = options.roots;
    this.#prober = options.prober;
    this.#writer = options.writer;
    this.#schedules = options.schedules;
    this.#removals = options.removals;
    this.#metadata = options.metadata;
    this.#log = options.log;
    this.#discover = options.discover ?? discoverMediaFiles;
    this.#now = options.now ?? Date.now;
  }

  /**
   * Starts a scan job for one root and returns its first status without
   * waiting for it. Refuses disabled or unknown roots, a root with a running
   * job, and every root once shutdown has begun.
   */
  async start(rootId: string): Promise<ScanStart> {
    const admission = this.#refuseScan(
      rootId,
      await this.#roots.findById(rootId),
    );
    if (admission.kind !== "admitted") {
      return admission;
    }

    // Registered synchronously after the check so two requests cannot both pass it.
    const job: ScanJob = {
      status: {
        id: randomUUID(),
        rootId,
        phase: "discovering",
        startedAt: this.#now(),
        finishedAt: null,
        discoveredCount: 0,
        settledCount: 0,
        probeFailedCount: 0,
        currentPath: null,
        lookupCount: 0,
        lookedUpCount: 0,
        currentTitle: null,
        cancelRequested: false,
        summary: null,
        error: null,
      },
      controller: new AbortController(),
      done: Promise.resolve(),
    };
    this.#jobs.set(rootId, job);
    job.done = this.#run(job, admission.root);
    return { kind: "started", status: snapshot(job.status) };
  }

  /** Reads the root's running or latest terminal job from memory only. */
  status(rootId: string): ScanStatus | undefined {
    const job = this.#jobs.get(rootId);
    return job && snapshot(job.status);
  }

  /**
   * Reports whether the root has a job that has not finished, for actions
   * such as catalog removal that must not race that job's commit.
   */
  isScanning(rootId: string): boolean {
    const job = this.#jobs.get(rootId);
    return job !== undefined && isRunning(job.status);
  }

  /**
   * Requests cancellation of the root's job and returns its status. Only a
   * discovering, probing, or enriching job is cancelled; a committing job
   * finishes.
   */
  cancel(rootId: string): ScanStatus | undefined {
    const job = this.#jobs.get(rootId);
    if (job === undefined) return undefined;
    if (isCancellable(job.status)) {
      job.status.cancelRequested = true;
      job.controller.abort();
    }
    return snapshot(job.status);
  }

  /**
   * Cancels every running job and waits until each has settled, which includes
   * every ffprobe child closing and every started TMDB lookup settling, so the
   * database can be closed safely afterwards.
   */
  async shutdown(): Promise<void> {
    this.#closing = true;
    const running = [...this.#jobs.values()].filter((job) =>
      isRunning(job.status),
    );
    for (const job of running) {
      this.cancel(job.status.rootId);
    }
    await Promise.all(running.map((job) => job.done));
  }

  /**
   * Returns the first reason this scan may not start, or the admitted root.
   * Runs after the root lookup's await, so a shutdown that began meanwhile
   * still wins, and synchronously before registration.
   */
  #refuseScan(
    rootId: string,
    found: MediaRoot | undefined,
  ): { kind: "admitted"; root: MediaRoot } | ScanStart {
    if (this.#closing) return { kind: "shutting_down" };
    const admission = admitRoot(found);
    if (admission.kind !== "admitted") return admission;
    if (this.isScanning(rootId)) return { kind: "scan_in_progress" };
    return admission;
  }

  /**
   * Runs one job to its terminal phase. Every unexpected error becomes
   * `scan_failed`, so the promise shutdown awaits always resolves.
   */
  async #run(job: ScanJob, root: MediaRoot): Promise<void> {
    let outcome: ScanOutcome;
    try {
      outcome = await this.#execute(job, root);
    } catch (error) {
      this.#log.error(
        { err: error, rootId: root.id, scanId: job.status.id },
        "Catalog scan failed unexpectedly",
      );
      outcome = {
        phase: "failed",
        error: {
          code: "scan_failed",
          message: "The scan failed unexpectedly; see the server log",
        },
      };
    }
    finishJob(job.status, outcome, this.#now());
  }

  // Runs every stage in order, recording progress; each stage before the commit observes the job's signal.
  async #execute(job: ScanJob, root: MediaRoot): Promise<ScanOutcome> {
    const { status } = job;
    const { signal } = job.controller;

    let files: DiscoveredMediaFile[];
    try {
      files = await this.#discover(root.path, {
        signal,
        onDiscovered: (count) => {
          status.discoveredCount = count;
        },
      });
    } catch (error) {
      if (signal.aborted) {
        return { phase: "cancelled" };
      }
      if (error instanceof MediaDiscoveryError) {
        return failed("media_root_unavailable", error.message);
      }
      throw error;
    }
    status.discoveredCount = files.length;
    status.phase = "probing";

    const outcomes = await this.#probeAll(files, job);
    // Re-checked after the await: a cancel can land while this run resumes,
    // when the phase still reads `probing`.
    if (outcomes === undefined || signal.aborted) {
      return { phase: "cancelled" };
    }

    // Outcomes are indexed like `files`, so identity order survives out-of-order probes.
    const candidates = files.map((file, index) =>
      createCatalogCandidate(file, outcomes[index], root.path),
    );
    const metadataMatches = await enrichCandidates({
      items: candidates.map((candidate) => ({
        candidate,
        hints: pathHintsBelow(root.path, candidate.path),
      })),
      // Read after probing, so a key saved during a long probe is used.
      apiKey: await this.#metadata.tmdbKeys.readKey(),
      settled: await this.#metadata.metadataMatches.findSettledPathKeys(
        root.id,
      ),
      tmdb: this.#metadata.tmdb,
      signal,
      now: this.#now,
      status,
    });
    // Re-checked after the await, as after probing.
    if (metadataMatches === undefined || signal.aborted) {
      return { phase: "cancelled" };
    }
    // From here on cancellation is ignored: the commit and schedule pass always finish.
    status.phase = "committing";
    status.currentPath = null;
    status.currentTitle = null;
    candidates.forEach(validateCatalogCandidate);

    const completedAt = this.#now();
    const commit = await this.#writer.commit({
      rootId: root.id,
      scannedAt: completedAt,
      candidates,
      metadataMatches,
    });
    if (commit.kind === "root_not_found") {
      return failed(
        "media_root_not_found",
        `Media root ${root.id} was removed before the scan committed; the catalog is unchanged`,
      );
    }
    if (commit.kind === "root_disabled") {
      return failed(
        "media_root_disabled",
        `Media root ${root.id} was disabled before the scan committed; the catalog is unchanged`,
      );
    }
    // Both log their own failures, so a completed commit is never reported
    // as failed. Purging first keeps the schedule pass from regenerating
    // around rows that are about to go.
    await this.#removals.purge(this.#log);
    await this.#schedules.ensureAllEnabled(this.#log);

    return {
      phase: "completed",
      summary: {
        rootId: root.id,
        startedAt: status.startedAt,
        completedAt,
        discoveredCount: files.length,
        probedCount: files.length - status.probeFailedCount,
        probeFailedCount: status.probeFailedCount,
        missingCount: commit.missingCount,
        ...countLookups(metadataMatches),
      },
    };
  }

  /**
   * Probes every file through the shared limit, counting each settled probe.
   * Item-level probe failures are staged; cancellation returns undefined and
   * an unexpected error is rethrown, both only after every started probe has
   * settled and its child has closed.
   */
  async #probeAll(
    files: readonly DiscoveredMediaFile[],
    { status, controller }: ScanJob,
  ): Promise<ProbeOutcome[] | undefined> {
    const { signal } = controller;
    const stop = new AbortController();
    // Every queued or running probe listens on this one signal by design, so
    // Node's default 10-listener leak warning would fire on any real media root.
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
          status.settledCount += 1;
          status.currentPath = file.path;
          return { kind: "probed", probedAt: this.#now(), result };
        } catch (error) {
          if (error instanceof MediaProbeError && !stop.signal.aborted) {
            status.settledCount += 1;
            status.probeFailedCount += 1;
            status.currentPath = file.path;
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
