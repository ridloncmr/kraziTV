import { randomUUID } from "node:crypto";

import {
  deriveChannelSeed,
  findRegenerationBoundary,
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
  ChannelChunk,
  ChunkResult,
  ChunkStart,
  EnsureCoverageResult,
  ScheduleChangeReason,
  ScheduleInputChange,
  ScheduleLog,
  ScheduleState,
  ScheduleWindow,
  WrittenChunk,
} from "./contracts.js";
import {
  checkCoverage,
  coverageAfterChunk,
  resolveTarget,
  warnIfGapRepaired,
} from "./schedule-coverage.js";
import {
  createScheduleState,
  deleteEntriesFrom,
  findChannelEnabled,
  findEntryAiringAt,
  findLatestScheduleMutation,
  insertEntries,
  listEntriesInWindow,
  loadProgress,
  loadScheduleSource,
  loadScheduleState,
  NO_PROGRESS,
  restoreDeletedProgress,
  updateScheduleState,
  upsertProgress,
} from "./schedule-repository.js";

interface ScheduleServiceOptions extends RecordSources {
  /** Caps the entries one transaction inserts; defaults to 500. */
  entriesPerTransaction?: number | undefined;
  /** Passed to every immediate transaction; a test pause point. */
  transactionHooks?: ImmediateTransactionHooks | undefined;
}

// Keeps one transaction's write authority short and one multi-row insert
// under SQLite's bound-variable limit.
const ENTRIES_PER_TRANSACTION = 500;

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
   * long. Never backfills: coverage that already ended is repaired from the
   * effective current time, leaving the uncovered interval empty.
   */
  async ensureCoverage(
    channelId: string,
    log: ScheduleLog,
    through?: number,
  ): Promise<EnsureCoverageResult> {
    for (;;) {
      const chunk = await runImmediateTransaction(
        this.#db,
        (trx) => this.#extendChunk(trx, channelId, log, through),
        { hooks: this.#transactionHooks },
      );
      warnIfGapRepaired(chunk, log);
      if (chunk.result.kind !== "extended") return chunk.result;
    }
  }

  /**
   * Rebuilds an enabled channel's future schedule on request: deletes entries
   * from the regeneration boundary, restores progress, and covers the horizon
   * or `through` again. A channel without state simply gets its first
   * schedule. A disabled channel is left untouched, unlike an input change,
   * because nothing about its programming changed.
   */
  async regenerate(
    channelId: string,
    log: ScheduleLog,
    through?: number,
  ): Promise<EnsureCoverageResult> {
    const chunk = await runImmediateTransaction(
      this.#db,
      async (trx): Promise<ChannelChunk> => {
        const enabled = await findChannelEnabled(trx, channelId);
        if (enabled === undefined) {
          return { channelId, result: { kind: "channel_not_found" } };
        }
        if (!enabled) return { channelId, result: { kind: "disabled" } };
        const state = await loadScheduleState(trx, channelId);
        if (state === undefined) {
          return this.#extendChunk(trx, channelId, log, through);
        }
        const effectiveNow = this.#effectiveNow(channelId, state, log);
        const target = resolveTarget(effectiveNow, through);
        if (typeof target !== "number") return { channelId, result: target };
        return this.#regenerateChunk(trx, state, effectiveNow, target);
      },
      { hooks: this.#transactionHooks },
    );

    return this.#finishChunk(chunk, "manual", log, through);
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
   * detect a schedule generated from stale programming. A channel that
   * already has a schedule regenerates from its boundary; one without gets
   * its first chunk. Completes coverage after the commit. Returns the
   * change's value.
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
        const chunks: ChannelChunk[] = [];
        for (const channelId of new Set(changed.affectedChannelIds)) {
          chunks.push(
            await this.#firstChunkAfterInput(trx, channelId, log, effectiveNow),
          );
        }
        return { value: changed.value, chunks };
      },
      { hooks: this.#transactionHooks },
    );

    // A failure here is logged, not thrown: the change already stands, and
    // the next ensure resumes from the committed chunk.
    for (const chunk of chunks) {
      try {
        await this.#finishChunk(chunk, reason, log);
      } catch (err) {
        log.warn(
          { channelId: chunk.channelId, reason, err },
          "Schedule input change committed but completing coverage failed",
        );
      }
    }
    return value;
  }

  /**
   * Applies an input change to one affected channel: a channel that already
   * has a schedule regenerates from its boundary toward a full horizon, and
   * one without gets its first chunk.
   */
  async #firstChunkAfterInput(
    trx: Kysely<DatabaseSchema>,
    channelId: string,
    log: ScheduleLog,
    effectiveNow: number,
  ): Promise<ChannelChunk> {
    const state = await loadScheduleState(trx, channelId);
    if (state === undefined) {
      return this.#extendChunk(trx, channelId, log, undefined, effectiveNow);
    }
    return this.#regenerateChunk(
      trx,
      state,
      effectiveNow,
      effectiveNow + SCHEDULE_HORIZON_MS,
    );
  }

  /**
   * Finishes a channel's coverage after its first chunk committed and logs
   * what happened. A repaired gap is warned about first, with its uncovered
   * interval, so the repair is recorded even if completing coverage then
   * fails. A manual request that regenerated nothing has nothing to log.
   */
  async #finishChunk(
    chunk: ChannelChunk,
    reason: ScheduleChangeReason,
    log: ScheduleLog,
    through?: number,
  ): Promise<EnsureCoverageResult> {
    const { channelId, regeneration } = chunk;
    warnIfGapRepaired(chunk, log);
    const result =
      chunk.result.kind === "extended"
        ? await this.ensureCoverage(channelId, log, through)
        : chunk.result;
    if (reason === "manual" && regeneration === undefined) return result;
    log.info(
      { channelId, reason, ...regeneration, result },
      reason === "manual"
        ? "Regenerated schedule"
        : "Applied schedule input change",
    );
    return result;
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
   * Rebuilds a scheduled channel from the regeneration boundary in the
   * caller's transaction. The airing entry is never touched; entries from
   * the boundary are deleted and their progress restored, then one chunk is
   * generated if the channel is enabled and schedulable. State is written,
   * and the revision advances once, only if an entry was deleted or inserted.
   */
  async #regenerateChunk(
    trx: Kysely<DatabaseSchema>,
    state: ScheduleState,
    effectiveNow: number,
    target: number,
  ): Promise<ChannelChunk> {
    const { channelId } = state;
    const airing = await findEntryAiringAt(trx, channelId, effectiveNow);
    const boundary = findRegenerationBoundary(airing, effectiveNow);
    const deleted = await deleteEntriesFrom(trx, channelId, boundary);
    await restoreDeletedProgress(trx, channelId, deleted, effectiveNow);

    const written = (await findChannelEnabled(trx, channelId))
      ? await this.#writeChunk(
          trx,
          channelId,
          {
            seed: state.seed,
            startsAt: boundary,
            nextSequenceNumber: state.nextSequenceNumber,
          },
          target,
          effectiveNow,
        )
      : undefined;
    const chunk = written?.kind === "written" ? written : undefined;
    const insertedEntryCount = chunk?.insertedEntryCount ?? 0;
    const changed = deleted.length > 0 || insertedEntryCount > 0;
    const next: ScheduleState = {
      ...state,
      lastGeneratedThrough: chunk?.lastGeneratedThrough ?? boundary,
      nextSequenceNumber: chunk?.nextSequenceNumber ?? state.nextSequenceNumber,
      scheduleRevision: state.scheduleRevision + (changed ? 1 : 0),
      updatedAt: effectiveNow,
    };
    // With nothing deleted, coverage already ends at or before the boundary,
    // so an untouched schedule keeps its state: a lapsed channel that cannot
    // be scheduled must keep where its coverage truly ended.
    if (changed) await updateScheduleState(trx, next);

    return {
      channelId,
      result:
        written === undefined
          ? { kind: "disabled" }
          : written.kind === "written"
            ? coverageAfterChunk(next, target)
            : written,
      regeneration: {
        boundary,
        deletedEntryCount: deleted.length,
        insertedEntryCount,
        // Generating past where coverage had already ended repairs a gap.
        ...(insertedEntryCount > 0 && state.lastGeneratedThrough < boundary
          ? { uncoveredFrom: state.lastGeneratedThrough }
          : {}),
      },
    };
  }

  /**
   * Generates and commits at most one chunk from where coverage ends. The
   * first chunk creates the channel's state, anchored at the effective time.
   * Coverage that already ended is repaired instead: regenerated from the
   * effective time, so a lapse of any length costs one fresh horizon. An
   * input change passes its own effective time, which already accounts for
   * every channel's last mutation.
   */
  async #extendChunk(
    trx: Kysely<DatabaseSchema>,
    channelId: string,
    log: ScheduleLog,
    through: number | undefined,
    inputTime?: number,
  ): Promise<ChannelChunk> {
    const settled = (result: ChunkResult): ChannelChunk => ({
      channelId,
      result,
    });
    const enabled = await findChannelEnabled(trx, channelId);
    if (enabled === undefined) return settled({ kind: "channel_not_found" });
    if (!enabled) return settled({ kind: "disabled" });

    const state = await loadScheduleState(trx, channelId);
    const effectiveNow = inputTime ?? this.#effectiveNow(channelId, state, log);
    const target = resolveTarget(effectiveNow, through);
    if (typeof target !== "number") return settled(target);
    if (state !== undefined && state.lastGeneratedThrough <= effectiveNow) {
      return this.#regenerateChunk(trx, state, effectiveNow, target);
    }
    const coverage = checkCoverage(state, target);
    if (coverage !== undefined) return settled(coverage);

    const anchorTime = state?.anchorTime ?? effectiveNow;
    const seed = state?.seed ?? deriveChannelSeed(channelId, anchorTime);
    const written = await this.#writeChunk(
      trx,
      channelId,
      {
        seed,
        startsAt: state?.lastGeneratedThrough ?? anchorTime,
        nextSequenceNumber: state?.nextSequenceNumber ?? 0,
      },
      target,
      effectiveNow,
    );
    if (written.kind === "unschedulable") return settled(written);

    const next: ScheduleState = {
      channelId,
      seed,
      anchorTime,
      lastGeneratedThrough: written.lastGeneratedThrough,
      nextSequenceNumber: written.nextSequenceNumber,
      scheduleRevision: (state?.scheduleRevision ?? 0) + 1,
      updatedAt: effectiveNow,
    };
    await (state === undefined
      ? createScheduleState(trx, next)
      : updateScheduleState(trx, next));
    return settled(coverageAfterChunk(next, target));
  }

  /**
   * Generates one bounded chunk toward `target` from the channel's block and
   * commits its entries and collection progress. Leaves schedule state to
   * the caller, which alone knows whether the revision advances.
   */
  async #writeChunk(
    trx: Kysely<DatabaseSchema>,
    channelId: string,
    start: ChunkStart,
    target: number,
    effectiveNow: number,
  ): Promise<WrittenChunk> {
    const source = await loadScheduleSource(trx, channelId);
    if (source === undefined) {
      return { kind: "unschedulable", reason: "no_programming_block" };
    }
    const generated = generateScheduleEntries({
      channelSeed: start.seed,
      source,
      progress:
        source.kind === "collection"
          ? await loadProgress(trx, channelId, source.mediaCollectionId)
          : NO_PROGRESS, // single items carry no collection progress
      startsAt: start.startsAt,
      through: target,
      nextSequenceNumber: start.nextSequenceNumber,
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
    return {
      kind: "written",
      lastGeneratedThrough: generated.generatedThrough,
      nextSequenceNumber: generated.nextSequenceNumber,
      insertedEntryCount: generated.entries.length,
    };
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
