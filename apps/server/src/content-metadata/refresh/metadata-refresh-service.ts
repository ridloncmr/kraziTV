import type { TmdbClient } from "@krazitv/media";
import type { ScheduledTask, TimerScheduler } from "@krazitv/signal";
import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import type { TmdbKeyService } from "../tmdb-key/tmdb-key-service.js";
import { lookUpDue, readDueRefreshes } from "./due-refreshes.js";
import { commitRefreshes, expireStoredFacts } from "./refresh-writes.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
/** How often a pass runs while the server is up. */
const CHECK_INTERVAL_MS = 60 * 60 * 1_000;
/** Facts this old are fetched again, leaving a month to retry before expiry. */
const REFRESH_AGE_MS = 150 * DAY_MS;
/** TMDB data stored this long is dropped; six months, rounded down to stay inside. */
const EXPIRY_AGE_MS = 180 * DAY_MS;

interface MetadataRefreshOptions {
  db: Kysely<DatabaseSchema>;
  tmdbKeys: Pick<TmdbKeyService, "readKey">;
  /** Must be the process's one TMDB client, whose queue every lookup shares. */
  tmdb: TmdbClient;
  /** Whether a root has a running scan or retry job, which refresh never races. */
  isScanning: (rootId: string) => boolean;
  timers: TimerScheduler;
  now: () => number;
  log: Pick<FastifyBaseLogger, "info" | "error">;
}

/**
 * Keeps stored TMDB data inside TMDB's six-month limit with no user action:
 * a pass at boot, when a scan or retry job ends, and an hour after each pass
 * expires data stored too long, then fetches again, by TMDB ID, the facts of
 * every matched item due for a refresh. Nothing is discovered, probed, or
 * searched. At most one pass runs at a time.
 */
export class MetadataRefreshService {
  readonly #options: MetadataRefreshOptions;
  readonly #stop = new AbortController();
  #next: ScheduledTask | undefined;
  #pass: Promise<void> = Promise.resolve();
  #running = false;
  /** A check asked for while a pass ran, which runs as soon as it ends. */
  #again = false;

  // Every collaborator is injected so tests drive time and TMDB.
  constructor(options: MetadataRefreshOptions) {
    this.#options = options;
  }

  /**
   * Runs a pass now without waiting for it, or right after the running one,
   * so a root a job held is caught as soon as the job ends. Each pass
   * schedules the next an hour after it, replacing any pass already
   * scheduled, so passes never overlap.
   */
  checkNow(): void {
    if (this.#stop.signal.aborted) return;
    this.#next?.cancel();
    this.#next = undefined;
    if (this.#running) {
      this.#again = true;
      return;
    }
    this.#running = true;
    this.#pass = this.#runLogged().then(() => {
      this.#running = false;
      if (this.#stop.signal.aborted) return;
      if (this.#again) {
        this.#again = false;
        this.checkNow();
        return;
      }
      this.#next = this.#options.timers.setTimeout(
        () => this.checkNow(),
        CHECK_INTERVAL_MS,
      );
    });
  }

  /**
   * Cancels the next pass and the running pass's TMDB lookups, then waits
   * for the running pass to settle, so the database can close afterwards.
   * A commit already under way finishes.
   */
  async shutdown(): Promise<void> {
    this.#stop.abort();
    this.#next?.cancel();
    await this.#pass;
  }

  /**
   * Requests a tracked pass and waits for its completion, sharing ownership
   * with scheduled checks so concurrent callers never run separate passes
   * and shutdown waits for their work too.
   */
  async refreshDue(): Promise<void> {
    this.checkNow();
    await this.#pass;
  }

  /** Runs provider work only while this service still owns its tracked pass. */
  async #refreshDue(): Promise<void> {
    const { db, tmdbKeys, tmdb, isScanning, now, log } = this.#options;
    const passAt = now();
    const expired = await expireStoredFacts(
      db,
      passAt - EXPIRY_AGE_MS,
      passAt,
      isScanning,
    );
    if (this.#stop.signal.aborted) return;
    if (expired > 0) log.info({ expired }, "Expired stored TMDB data");
    const apiKey = await tmdbKeys.readKey();
    if (apiKey === undefined || this.#stop.signal.aborted) return;
    const due = (await readDueRefreshes(db, passAt - REFRESH_AGE_MS)).filter(
      (item) => !isScanning(item.rootId),
    );
    if (due.length === 0 || this.#stop.signal.aborted) return;
    const answers = await lookUpDue(tmdb, apiKey, due, this.#stop.signal);
    if (this.#stop.signal.aborted) return;
    const counts = await commitRefreshes(db, answers, now(), isScanning);
    log.info(counts, "Refreshed TMDB data");
  }

  /**
   * Runs one pass and logs an unexpected failure instead of throwing, so the
   * next pass is still scheduled. A shutdown's abort is not a failure.
   */
  async #runLogged(): Promise<void> {
    try {
      await this.#refreshDue();
    } catch (error) {
      if (this.#stop.signal.aborted) return;
      this.#options.log.error({ err: error }, "TMDB refresh failed");
    }
  }
}
