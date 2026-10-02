import { randomUUID } from "node:crypto";

import {
  deriveChannelSeed,
  generateScheduleEntries,
  SCHEDULE_HORIZON_MS,
} from "@krazitv/krazi-brain";
import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import {
  type ImmediateTransactionHooks,
  runImmediateTransaction,
} from "../database/writes/immediate-transaction.js";
import type { RecordSources } from "../database/writes/record-sources.js";
import type {
  EnsureCoverageResult,
  ScheduleChangeReason,
  ScheduleInputChange,
  ScheduleLog,
  ScheduleState,
  ScheduleWindow,
} from "./contracts.js";
import {
  createScheduleState,
  findChannelEnabled,
  findLatestScheduleMutation,
  insertEntries,
  listEntriesInWindow,
  loadProgress,
  loadScheduleSource,
  loadScheduleState,
  NO_PROGRESS,
  updateScheduleState,
  upsertProgress,
} from "./schedule-repository.js";

interface ScheduleServiceOptions extends RecordSources {
  /** Caps the entries one transaction inserts; defaults to 500. */
  entriesPerTransaction?: number | undefined;
  /** Passed to every immediate transaction; a test pause point. */
  transactionHooks?: ImmediateTransactionHooks | undefined;
}

/** One chunk committed entries but coverage still falls short of the target. */
type ChunkResult = EnsureCoverageResult | { kind: "extended" };

// Keeps one transaction's write authority short and one multi-row insert
// under SQLite's bound-variable limit.
const ENTRIES_PER_TRANSACTION = 500;

/**
 * Bounds one synchronous schedule request: a read window's length, and how
 * far past the effective current time a requested instant may reach.
 */
export const SCHEDULE_REQUEST_LIMIT_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The only writer of schedule entries, schedule state, and collection
 * progress. Every mutation runs in an immediate transaction and reads its
 * effective current time only after acquiring write authority.
 */
export class ScheduleService {
  readonly #db: Kysely<DatabaseSchema>;
  readonly #now: () => number;
  readonly #createId: () => string;
  readonly #entriesPerTransaction: number;
  readonly #transactionHooks: ImmediateTransactionHooks | undefined;

  // Clock, IDs, chunk size, and hooks are injectable so tests stay deterministic.
  constructor(
    db: Kysely<DatabaseSchema>,
    options: ScheduleServiceOptions = {},
  ) {
    this.#db = db;
    this.#now = options.now ?? Date.now;
    this.#createId = options.createId ?? randomUUID;
    this.#entriesPerTransaction =
      options.entriesPerTransaction ?? ENTRIES_PER_TRANSACTION;
    // A chunk that may insert nothing would loop forever without covering anything.
    if (
      !Number.isSafeInteger(this.#entriesPerTransaction) ||
      this.#entriesPerTransaction < 1
    ) {
      throw new RangeError(
        `entriesPerTransaction must be a positive integer, got ${this.#entriesPerTransaction}`,
      );
    }
    this.#transactionHooks = options.transactionHooks;
  }

  /**
   * Materializes an enabled channel's schedule at least a full horizon past
   * the effective current time, or through `through` when that is later. Extends in chunks, each its
   * own transaction that re-reads state, so concurrent callers never
   * duplicate or overlap entries and no transaction holds write authority
   * long. Never backfills: coverage that already ended reports a gap.
   */
  async ensureCoverage(
    channelId: string,
    log: ScheduleLog,
    through?: number,
  ): Promise<EnsureCoverageResult> {
    for (;;) {
      const result = await runImmediateTransaction(
        this.#db,
        (trx) => this.#extendChunk(trx, channelId, log, through),
        { hooks: this.#transactionHooks },
      );
      if (result.kind !== "extended") return result;
    }
  }

  /**
   * Reads the channel's entries overlapping `[start, end)` in one deferred
   * snapshot that reads the revision first, so a reader never pairs new
   * programming with an old revision. Never writes; callers ensure coverage
   * first.
   */
  async readWindow(
    channelId: string,
    start: number,
    end: number,
  ): Promise<ScheduleWindow> {
    return this.#db.transaction().execute(async (trx) => {
      const state = await loadScheduleState(trx, channelId);
      return {
        scheduleRevision: state?.scheduleRevision ?? null,
        entries: await listEntriesInWindow(trx, channelId, start, end),
      };
    });
  }

  /**
   * Commits a scheduling input write together with each affected channel's
   * first chunk in one immediate transaction, because no later check could
   * detect a schedule generated from stale programming. Completes coverage
   * after the commit. Returns the change's value.
   */
  async applyInputChange<T>(
    log: ScheduleLog,
    reason: ScheduleChangeReason,
    change: ScheduleInputChange<T>,
  ): Promise<T> {
    const { value, chunks } = await runImmediateTransaction(
      this.#db,
      async (trx) => {
        const effectiveNow = await this.#effectiveInputTime(trx, log);
        const changed = await change(trx, effectiveNow);
        const chunks: { channelId: string; result: ChunkResult }[] = [];
        for (const channelId of new Set(changed.affectedChannelIds)) {
          const result = await this.#extendChunk(
            trx,
            channelId,
            log,
            undefined,
            effectiveNow,
          );
          chunks.push({ channelId, result });
        }
        return { value: changed.value, chunks };
      },
      { hooks: this.#transactionHooks },
    );

    for (const { channelId, result } of chunks) {
      await this.#completeCoverage(channelId, result, reason, log);
    }
    return value;
  }

  /**
   * Finishes a channel's coverage after its input change committed, and logs
   * the outcome. A failure is logged, not thrown: the change already stands,
   * and the next ensure resumes from the committed chunk.
   */
  async #completeCoverage(
    channelId: string,
    firstChunk: ChunkResult,
    reason: ScheduleChangeReason,
    log: ScheduleLog,
  ): Promise<void> {
    try {
      const result =
        firstChunk.kind === "extended"
          ? await this.ensureCoverage(channelId, log)
          : firstChunk;
      log.info({ channelId, reason, result }, "Applied schedule input change");
    } catch (err) {
      log.warn(
        { channelId, reason, err },
        "Schedule input change committed but completing coverage failed",
      );
    }
  }

  /**
   * Returns one effective time for an input change: the later of the clock
   * and the latest schedule mutation on any channel. Computed before the
   * change runs, when its affected channels are still unknown, so it can
   * never fall behind any of their schedules. Logs when it clamps.
   */
  async #effectiveInputTime(
    trx: Kysely<DatabaseSchema>,
    log: ScheduleLog,
  ): Promise<number> {
    const now = this.#now();
    const latest = await findLatestScheduleMutation(trx);
    if (latest === undefined || now >= latest) return now;
    log.warn(
      { now, effectiveNow: latest },
      "Clock is behind the latest schedule mutation; using the mutation's time",
    );
    return latest;
  }

  /**
   * Generates and commits at most one chunk from where coverage ends. The
   * first chunk creates the channel's state, anchored at the effective time.
   * An input change passes its own effective time, which already accounts
   * for every channel's last mutation.
   */
  async #extendChunk(
    trx: Kysely<DatabaseSchema>,
    channelId: string,
    log: ScheduleLog,
    through: number | undefined,
    inputTime?: number,
  ): Promise<ChunkResult> {
    const enabled = await findChannelEnabled(trx, channelId);
    if (enabled === undefined) return { kind: "channel_not_found" };
    if (!enabled) return { kind: "disabled" };

    const state = await loadScheduleState(trx, channelId);
    const effectiveNow = inputTime ?? this.#effectiveNow(channelId, state, log);
    const latestThrough = effectiveNow + SCHEDULE_REQUEST_LIMIT_MS;
    if (through !== undefined && through > latestThrough) {
      return { kind: "through_out_of_range", latestThrough };
    }
    // A floor, never a cap: the target always lies past now, so every
    // generated chunk inserts at least one entry.
    const target = Math.max(through ?? 0, effectiveNow + SCHEDULE_HORIZON_MS);
    const coverage = checkCoverage(state, effectiveNow, target);
    if (coverage !== undefined) return coverage;

    const source = await loadScheduleSource(trx, channelId);
    if (source === undefined) {
      return { kind: "unschedulable", reason: "no_programming_block" };
    }
    const anchorTime = state?.anchorTime ?? effectiveNow;
    const seed = state?.seed ?? deriveChannelSeed(channelId, anchorTime);
    const generated = generateScheduleEntries({
      channelSeed: seed,
      source,
      progress:
        source.kind === "collection"
          ? await loadProgress(trx, channelId, source.mediaCollectionId)
          : NO_PROGRESS, // single items carry no collection progress
      startsAt: state?.lastGeneratedThrough ?? anchorTime,
      through: target,
      nextSequenceNumber: state?.nextSequenceNumber ?? 0,
      maxEntries: this.#entriesPerTransaction,
    });
    if (generated.kind === "unschedulable") {
      return { kind: "unschedulable", reason: "no_schedulable_media" };
    }

    await insertEntries(
      trx,
      channelId,
      generated.entries,
      this.#createId,
      effectiveNow,
    );
    if (source.kind === "collection") {
      await upsertProgress(
        trx,
        channelId,
        source.mediaCollectionId,
        generated.progress,
        effectiveNow,
      );
    }
    const next: ScheduleState = {
      channelId,
      seed,
      anchorTime,
      lastGeneratedThrough: generated.generatedThrough,
      nextSequenceNumber: generated.nextSequenceNumber,
      scheduleRevision: (state?.scheduleRevision ?? 0) + 1,
      updatedAt: effectiveNow,
    };
    await (state === undefined
      ? createScheduleState(trx, next)
      : updateScheduleState(trx, next));

    return next.lastGeneratedThrough >= target
      ? {
          kind: "covered",
          scheduleRevision: next.scheduleRevision,
          generatedThrough: next.lastGeneratedThrough,
        }
      : { kind: "extended" };
  }

  /**
   * Returns the later of the clock and the last schedule mutation, so a clock
   * stepping backward can never move generation before earlier work. Logs
   * when it clamps.
   */
  #effectiveNow(
    channelId: string,
    state: ScheduleState | undefined,
    log: ScheduleLog,
  ): number {
    const now = this.#now();
    if (state === undefined || now >= state.updatedAt) return now;
    log.warn(
      { channelId, now, effectiveNow: state.updatedAt },
      "Clock is behind the last schedule mutation; using the mutation's time",
    );
    return state.updatedAt;
  }
}

/**
 * Settles a channel whose existing coverage needs no write: a gap when it
 * already ended, covered when it reaches the target. Returns undefined when
 * a chunk must be generated.
 */
function checkCoverage(
  state: ScheduleState | undefined,
  effectiveNow: number,
  target: number,
): EnsureCoverageResult | undefined {
  if (state === undefined) return undefined;
  if (state.lastGeneratedThrough <= effectiveNow) {
    return { kind: "schedule_gap" };
  }
  if (state.lastGeneratedThrough >= target) {
    return {
      kind: "covered",
      scheduleRevision: state.scheduleRevision,
      generatedThrough: state.lastGeneratedThrough,
    };
  }
  return undefined;
}
