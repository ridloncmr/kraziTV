import { randomUUID } from "node:crypto";

import {
  type CollectionProgress,
  deriveChannelSeed,
  deriveProgrammingSeed,
  findRegenerationBoundary,
  generateProgramming,
  orderFingerprint,
  type ProgrammingAssignment,
  type Reservation,
  type RestorableEntry,
  SCHEDULE_HORIZON_MS,
} from "@krazitv/krazi-brain";
import { assertPositiveSafeInteger } from "@krazitv/process";
import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import {
  type ImmediateTransactionHooks,
  runImmediateTransaction,
} from "../database/writes/immediate-transaction.js";
import type { RecordSources } from "../database/writes/record-sources.js";
import type {
  AdmissionFailure,
  ChannelAdmission,
  CollectionPreview,
  ChannelChunk,
  ChunkResult,
  ChunkStart,
  EnsureCoverageResult,
  ProgrammingPreview,
  ScheduleChangeReason,
  ScheduleInputChange,
  ScheduleLog,
  ScheduleState,
  ScheduleWindow,
  WrittenChunk,
} from "./contracts.js";
import {
  checkCoverage,
  clampToLastMutation,
  coverageAfterChunk,
  resolveTarget,
  warnIfGapRepaired,
} from "./schedule-coverage.js";
import {
  findAssignedCollectionMode,
  loadCollectionMembers,
  loadConfigurationRevision,
  loadMarathonSettings,
  loadProgrammingAssignments,
} from "./persistence/assignment-sources.js";
import {
  loadProgress,
  readRestoredProgress,
  recordOrderFingerprint,
  restoreDeletedProgress,
  upsertProgress,
} from "./persistence/collection-progress.js";
import {
  deleteEmptyBlocks,
  insertBlocks,
  loadLatestTurn,
} from "./persistence/generated-blocks.js";
import {
  createScheduleState,
  deleteEntriesFrom,
  deleteWithdrawnCutEntries,
  findChannelEnabled,
  findLatestScheduleMutation,
  insertEntries,
  listEnabledChannelIds,
  listRestorableEntriesFrom,
  listUpcomingCollectionEntries,
  loadScheduleState,
  updateScheduleState,
} from "./persistence/schedule-repository.js";
import {
  findAiringItem,
  readAiringAt,
  readGuideEntries,
  readTimeline,
} from "../playout/persistence/playout-reads.js";
import { loadProgrammingRules } from "../programming-rules/rule-rows.js";
import type {
  ReservationPreview,
  ReservationSettings,
} from "../reservations/contracts.js";
import { resolveReservationRange } from "../reservations/persistence/reservation-refusals.js";
import {
  clearUnstartedInterruptions,
  loadReservations,
  resolveReservation,
} from "../reservations/persistence/reservation-rows.js";
import {
  programmingTimezoneChange,
  recordTimezoneUnlessRulesNeedIt,
} from "./timezone-change.js";

interface ScheduleServiceOptions extends RecordSources {
  /** Names generated blocks; separate from entry IDs so tests can name each. */
  createBlockId?: (() => string) | undefined;
  /** Caps the entries one transaction inserts; defaults to 500. */
  entriesPerTransaction?: number | undefined;
  /** Passed to every immediate transaction; a test pause point. */
  transactionHooks?: ImmediateTransactionHooks | undefined;
  /**
   * The IANA timezone programming rules are evaluated in. Production passes
   * the one startup resolved; suites that set no rule may leave it UTC.
   */
  programmingTimezone?: string | undefined;
}

// Keeps one transaction's write authority short and one multi-row insert
// under SQLite's bound-variable limit.
const ENTRIES_PER_TRANSACTION = 500;

// Bounds one programming preview, as a transaction bounds one chunk.
const PREVIEW_MAX_ENTRIES = 2000;

// Names the reservation a preview adds, which is never saved.
const PREVIEW_RESERVATION_ID = "preview-reservation";

// How many upcoming selections a collection preview shows.
const PREVIEW_UPCOMING_ENTRIES = 10;

/**
 * The only writer of schedule entries, generated programming blocks,
 * schedule state, and collection progress, apart from catalog purge, which deletes only entries that have
 * ended, and two input changes this service runs in its own transaction:
 * the maintenance pass's ordering change, which records an order
 * fingerprint, and a progress reset. Every mutation runs in an immediate
 * transaction and reads its effective current time only after acquiring
 * write authority.
 */
export class ScheduleService {
  readonly #db: Kysely<DatabaseSchema>;
  readonly #now: () => number;
  readonly #createId: () => string;
  readonly #createBlockId: () => string;
  readonly #entriesPerTransaction: number;
  readonly #transactionHooks: ImmediateTransactionHooks | undefined;
  readonly #programmingTimezone: string;

  // Clock, IDs, chunk size, hooks, and timezone are injectable so tests stay deterministic.
  constructor(
    db: Kysely<DatabaseSchema>,
    options: ScheduleServiceOptions = {},
  ) {
    this.#db = db;
    this.#now = options.now ?? Date.now;
    this.#createId = options.createId ?? randomUUID;
    this.#createBlockId = options.createBlockId ?? randomUUID;
    this.#entriesPerTransaction =
      options.entriesPerTransaction ?? ENTRIES_PER_TRANSACTION;
    // A chunk that may insert nothing would loop forever without covering anything.
    assertPositiveSafeInteger(
      this.#entriesPerTransaction,
      "entriesPerTransaction",
    );
    this.#transactionHooks = options.transactionHooks;
    this.#programmingTimezone = options.programmingTimezone ?? "UTC";
  }

  /**
   * Applies the programming timezone at startup: records it when no
   * channel has a rule, and otherwise, when it changed, regenerates the
   * channels with rules after their airing entries in one input change.
   * Returns undefined when nothing needed regenerating.
   */
  async applyProgrammingTimezone(log: ScheduleLog) {
    const timeZone = this.#programmingTimezone;
    const needed = await this.#immediate((trx) =>
      recordTimezoneUnlessRulesNeedIt(trx, timeZone),
    );
    if (!needed) return undefined;
    return this.applyInputChange(
      log,
      "programming_timezone_changed",
      programmingTimezoneChange(timeZone),
    );
  }

  /** Names the timezone this service evaluates programming rules in. */
  programmingTimezone(): string {
    return this.#programmingTimezone;
  }

  /**
   * Reads the clock this service writes by. Playout reads use it as their
   * only clock, so they evaluate the same time coverage is generated for.
   */
  now(): number {
    return this.#now();
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
      const chunk = await this.#immediate((trx) =>
        this.#extendChunk(trx, channelId, log, through),
      );
      warnIfGapRepaired(chunk, log);
      if (chunk.result.kind !== "extended") return chunk.result;
    }
  }

  /**
   * Ensures coverage for every enabled channel, at startup and after catalog
   * scans, so the horizon heals without a timer. Never throws: each failure
   * is logged and the next trigger retries, so one broken channel cannot
   * block the others or the caller.
   */
  async ensureAllEnabled(log: ScheduleLog): Promise<void> {
    let channelIds: string[];
    try {
      channelIds = await listEnabledChannelIds(this.#db);
    } catch (err) {
      log.warn(
        { err },
        "Listing enabled channels for schedule coverage failed",
      );
      return;
    }
    for (const channelId of channelIds) {
      try {
        await this.ensureCoverage(channelId, log);
      } catch (err) {
        log.warn({ channelId, err }, "Ensuring schedule coverage failed");
      }
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
    const chunk = await this.#immediate(async (trx): Promise<ChannelChunk> => {
      const admission = await this.#admit(trx, channelId, log, through);
      if (admission.kind !== "admitted") {
        return { channelId, result: admission };
      }
      const { state, effectiveNow, target } = admission;
      return state === undefined
        ? this.#extendAdmitted(trx, channelId, admission)
        : this.#regenerateChunk(trx, state, effectiveNow, target);
    });

    return this.#finishChunk(chunk, "manual", log, through);
  }

  /**
   * Reads the channel's entries overlapping `[start, end)`, and the planned
   * filler between them, in one deferred snapshot that reads the revision
   * first, so a reader never pairs new programming with an old revision.
   * Filler is derived, never an entry (ADR 0014). Never writes; callers
   * ensure coverage first.
   */
  async readWindow(
    channelId: string,
    start: number,
    end: number,
  ): Promise<ScheduleWindow> {
    return this.#db.transaction().execute(async (trx) => {
      const state = await loadScheduleState(trx, channelId);
      const entries = await readGuideEntries(trx, channelId, start, end);
      const items =
        state === undefined
          ? []
          : await readTimeline(
              trx,
              {
                channelId,
                scheduleRevision: state.scheduleRevision,
                anchorTime: state.anchorTime,
              },
              start,
              end,
            );
      return {
        scheduleRevision: state?.scheduleRevision ?? null,
        entries,
        fillerIntervals: items.flatMap((item) =>
          item.type === "filler"
            ? [{ startsAt: item.startsAt, endsAt: item.endsAt }]
            : [],
        ),
      };
    });
  }

  /**
   * Reads what a collection preview explains, in one deferred snapshot so
   * the members and the upcoming entries come from the same schedule: an
   * assigned collection's members, the mode its assignment plays it in, and
   * its next entries in that mode from the current time. Never generates or
   * writes. Returns undefined unless the channel's assignment holds the
   * collection.
   */
  async readCollectionPreview(
    channelId: string,
    assignmentId: string,
    mediaCollectionId: string,
  ): Promise<CollectionPreview | undefined> {
    return this.#db.transaction().execute(async (trx) => {
      const playbackMode = await findAssignedCollectionMode(trx, {
        channelId,
        assignmentId,
        mediaCollectionId,
      });
      if (playbackMode === undefined) return undefined;
      return {
        playbackMode,
        members: await loadCollectionMembers(trx, mediaCollectionId),
        upcoming: await listUpcomingCollectionEntries(
          trx,
          channelId,
          { mediaCollectionId, playbackMode },
          this.#now(),
          PREVIEW_UPCOMING_ENTRIES,
        ),
      };
    });
  }

  /**
   * Previews the channel's programming as a regeneration from now would
   * generate it, without writing: the same boundary, kept turn, restored
   * progress, rotation state, and cooldown, run through kraziPlan on copied
   * inputs across a horizon. Read in one deferred snapshot, so previewing
   * changes no entry, block, progress, decision, or revision.
   */
  async previewProgramming(
    channelId: string,
    log: ScheduleLog,
  ): Promise<ProgrammingPreview> {
    return this.#previewSnapshot(
      channelId,
      log,
      async (trx, state, effectiveNow) => {
        const { inputs, generated } = await this.#previewGeneration(
          trx,
          channelId,
          state,
          effectiveNow,
        );
        return generated.kind === "unschedulable"
          ? generated
          : {
              kind: "preview",
              continuedTurn: inputs.latestTurn?.block,
              marathons: inputs.marathons,
              blocks: generated.blocks,
              entries: generated.entries,
              skips: generated.skips,
              ruleSkips: generated.ruleSkips,
              configurationRevision: await loadConfigurationRevision(
                trx,
                channelId,
              ),
            };
      },
    );
  }

  /**
   * Previews what saving a reservation would air, without writing: the same
   * checks a save runs, then the programming a regeneration with it would
   * generate, through at least its end, from copied inputs in one deferred
   * snapshot. A refused reservation is previewed as its refusal.
   */
  async previewReservation(
    channelId: string,
    settings: ReservationSettings,
    log: ScheduleLog,
  ): Promise<ReservationPreview> {
    return this.#previewSnapshot(
      channelId,
      log,
      async (trx, state, effectiveNow) => {
        const scheduleRevision = state?.scheduleRevision ?? null;
        const range = await resolveReservationRange(
          trx,
          channelId,
          settings,
          effectiveNow,
        );
        if (range.kind !== "resolved") {
          return { kind: "refused", refusal: range, scheduleRevision };
        }
        const reservation = await resolveReservation(trx, {
          id: PREVIEW_RESERVATION_ID,
          startsAt: range.startsAt,
          endsAt: range.endsAt,
          source: settings.source,
        });
        const { boundary, reservations, generated } =
          await this.#previewGeneration(
            trx,
            channelId,
            state,
            effectiveNow,
            reservation,
          );
        if (generated.kind === "unschedulable") {
          return { ...generated, scheduleRevision };
        }
        return {
          kind: "preview",
          scheduleRevision,
          startsAt: reservation.startsAt,
          endsAt: reservation.endsAt,
          endKind: range.endKind,
          boundary,
          reservations,
          reservationBlockId: generated.blocks.find(
            (block) => block.reservationId === PREVIEW_RESERVATION_ID,
          )?.id,
          entries: generated.entries,
        };
      },
    );
  }

  /**
   * Opens the one deferred snapshot a preview reads in, refusing an unknown
   * channel, and hands it the channel's state and the effective time a
   * regeneration from now would use. Previews never write.
   */
  #previewSnapshot<T>(
    channelId: string,
    log: ScheduleLog,
    read: (
      trx: Kysely<DatabaseSchema>,
      state: ScheduleState | undefined,
      effectiveNow: number,
    ) => Promise<T>,
  ): Promise<T | { kind: "channel_not_found" }> {
    return this.#db.transaction().execute(async (trx) => {
      if ((await findChannelEnabled(trx, channelId)) === undefined) {
        return { kind: "channel_not_found" as const };
      }
      const state = await loadScheduleState(trx, channelId);
      const effectiveNow = clampToLastMutation(
        this.#now(),
        state?.updatedAt,
        log,
        { channelId },
      );
      return read(trx, state, effectiveNow);
    });
  }

  /**
   * Runs kraziPlan from the regeneration boundary on copied inputs, as a
   * regeneration from now would, adding a reservation not yet saved when
   * one is given and generating through at least its end. The one
   * generator both previews share; it never writes.
   */
  async #previewGeneration(
    trx: Kysely<DatabaseSchema>,
    channelId: string,
    state: ScheduleState | undefined,
    effectiveNow: number,
    added?: Reservation,
  ) {
    // An unsaved interrupting reservation cuts what airs at its start
    // (ADR 0015); a save refuses any other that starts before the boundary.
    const boundary = Math.min(
      findRegenerationBoundary(
        await findAiringItem(trx, channelId, effectiveNow),
        effectiveNow,
      ),
      added?.startsAt ?? Infinity,
    );
    const { collections: _, ...stored } = await loadProgrammingInputs(
      trx,
      channelId,
      boundary,
      boundary,
    );
    const inputs =
      added === undefined
        ? stored
        : { ...stored, reservations: [...stored.reservations, added] };
    const anchorTime = state?.anchorTime ?? effectiveNow;
    let previewed = 0;
    const generated = generateProgramming({
      channelSeed: state?.seed ?? deriveChannelSeed(channelId, anchorTime),
      programmingSeed:
        state?.programmingSeed ?? deriveProgrammingSeed(channelId, anchorTime),
      rebuildCount: state?.rebuildCount ?? 0,
      ...inputs,
      timeZone: this.#programmingTimezone,
      startsAt: boundary,
      through: Math.max(boundary + SCHEDULE_HORIZON_MS, added?.endsAt ?? 0),
      nextSequenceNumber: state?.nextSequenceNumber ?? 0,
      maxEntries: PREVIEW_MAX_ENTRIES,
      createBlockId: () => `preview-${(previewed += 1)}`,
    });
    return { boundary, inputs, reservations: inputs.reservations, generated };
  }

  /**
   * Commits a scheduling input write together with each affected channel's
   * first chunk in one immediate transaction, because no later check could
   * detect a schedule generated from stale programming. A channel that
   * already has a schedule regenerates from its boundary; one without gets
   * its first chunk, and one the user chose to interrupt is rebuilt from the
   * effective time instead. The change's `afterRegeneration` step then runs
   * in the same transaction. Completes coverage after the commit, first
   * handing the committed value to `onCommitted`, so a caller can act on a
   * change the moment it stands. Returns the change's value.
   */
  async applyInputChange<T>(
    log: ScheduleLog,
    reason: ScheduleChangeReason,
    change: ScheduleInputChange<T>,
    onCommitted?: (value: T) => void,
  ): Promise<T> {
    const { value, chunks } = await this.#immediate(async (trx) => {
      // Computed before the change runs, when its affected channels are still
      // unknown, so it clamps to the latest mutation on any channel and can
      // never fall behind any of their schedules.
      const effectiveNow = clampToLastMutation(
        this.#now(),
        await findLatestScheduleMutation(trx),
        log,
      );
      const changed = await change(trx, effectiveNow);
      const interrupted = new Set(changed.interruptedChannelIds);
      const chunks: ChannelChunk[] = [];
      for (const channelId of new Set(changed.affectedChannelIds)) {
        chunks.push(
          interrupted.has(channelId)
            ? await this.#interruptAfterInput(trx, channelId, log, effectiveNow)
            : await this.#firstChunkAfterInput(
                trx,
                channelId,
                log,
                effectiveNow,
              ),
        );
      }
      await changed.afterRegeneration?.(
        trx,
        new Set(
          chunks
            .filter((chunk) => chunk.revisionAdvanced)
            .map((chunk) => chunk.channelId),
        ),
      );
      return { value: changed.value, chunks };
    });
    onCommitted?.(value);

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
   * Applies an input change to a channel whose airing entry the user chose
   * to interrupt. A channel without a schedule has nothing airing, so it
   * gets its first chunk as any input change gives it.
   */
  async #interruptAfterInput(
    trx: Kysely<DatabaseSchema>,
    channelId: string,
    log: ScheduleLog,
    effectiveNow: number,
  ): Promise<ChannelChunk> {
    const state = await loadScheduleState(trx, channelId);
    if (state === undefined) {
      return this.#firstChunkAfterInput(trx, channelId, log, effectiveNow);
    }
    return this.#interruptChunk(
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
   * Rebuilds a scheduled channel from the regeneration boundary in the
   * caller's transaction. What airs is never touched (ADR 0003, ADR 0014):
   * entries from the end of the airing program or planned filler, or from
   * now when nothing airs, are replaced. A withdrawn cut's entries are
   * deleted first, so they cannot hide the restored airing item, and any
   * entry starting after now but before the boundary goes too: only a
   * withdrawn cut or a deleted early end leaves one (ADR 0015).
   */
  async #regenerateChunk(
    trx: Kysely<DatabaseSchema>,
    state: ScheduleState,
    effectiveNow: number,
    target: number,
  ): Promise<ChannelChunk> {
    const withdrawn = await deleteWithdrawnCutEntries(
      trx,
      state.channelId,
      effectiveNow,
    );
    const airing = await findAiringItem(trx, state.channelId, effectiveNow);
    const boundary = findRegenerationBoundary(airing, effectiveNow);
    return this.#rebuildChunk(
      trx,
      state,
      {
        deleteFrom: Math.min(boundary, effectiveNow + 1),
        startsAt: boundary,
        alreadyDeleted: withdrawn,
      },
      effectiveNow,
      target,
    );
  }

  /**
   * Rebuilds a scheduled channel from the effective time, replacing the
   * entry airing now. Only a user's explicit choice reaches this (the ADR
   * 0003 amendment): the airing entry and every later one are deleted and
   * their progress restored, and the interval from the deleted entry's start
   * to now is left empty, in the past. A special that cut the replaced entry
   * no longer cuts anything, so its interrupting flag is cleared.
   */
  async #interruptChunk(
    trx: Kysely<DatabaseSchema>,
    state: ScheduleState,
    effectiveNow: number,
    target: number,
  ): Promise<ChannelChunk> {
    const airing = await readAiringAt(trx, state.channelId, effectiveNow);
    const program = airing?.kind === "program" ? airing : undefined;
    await clearUnstartedInterruptions(trx, state.channelId, effectiveNow);
    return this.#rebuildChunk(
      trx,
      state,
      {
        deleteFrom: program?.startsAt ?? effectiveNow,
        startsAt: effectiveNow,
        interruptedFrom: program?.startsAt,
      },
      effectiveNow,
      target,
    );
  }

  /**
   * Deletes the channel's entries starting at or after `span.deleteFrom`,
   * restores progress from them, and generates one chunk from
   * `span.startsAt` if the channel is enabled and schedulable. State is
   * written, and the revision advances once, only if an entry was deleted or
   * inserted. Callers choose the positions; this never decides what may be
   * replaced.
   */
  async #rebuildChunk(
    trx: Kysely<DatabaseSchema>,
    state: ScheduleState,
    span: {
      deleteFrom: number;
      startsAt: number;
      interruptedFrom?: number;
      /** Entries the caller already deleted, whose progress restores here too. */
      alreadyDeleted?: RestorableEntry[];
    },
    effectiveNow: number,
    target: number,
  ): Promise<ChannelChunk> {
    const { channelId } = state;
    const { startsAt: boundary } = span;
    const deleted = [
      ...(span.alreadyDeleted ?? []),
      ...(await deleteEntriesFrom(trx, channelId, span.deleteFrom)),
    ];
    await restoreDeletedProgress(trx, channelId, deleted, effectiveNow);
    await deleteEmptyBlocks(trx, channelId);

    const written = (await findChannelEnabled(trx, channelId))
      ? await this.#writeChunk(
          trx,
          channelId,
          {
            seed: state.seed,
            programmingSeed: state.programmingSeed,
            rebuildCount: state.rebuildCount,
            startsAt: boundary,
            nextSequenceNumber: state.nextSequenceNumber,
            recordsOrder: true,
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
      revisionAdvanced: changed,
      regeneration: {
        boundary,
        ...(span.interruptedFrom === undefined
          ? {}
          : { interruptedFrom: span.interruptedFrom }),
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
    const admission = await this.#admit(
      trx,
      channelId,
      log,
      through,
      inputTime,
    );
    if (admission.kind !== "admitted") {
      return { channelId, result: admission };
    }
    return this.#extendAdmitted(trx, channelId, admission);
  }

  /**
   * Extends an admitted channel by one chunk, or repairs it from the
   * effective time when its coverage already ended. Split from admission so
   * `regenerate` can give a channel without state its first chunk without
   * admitting it twice.
   */
  async #extendAdmitted(
    trx: Kysely<DatabaseSchema>,
    channelId: string,
    { state, effectiveNow, target }: ChannelAdmission,
  ): Promise<ChannelChunk> {
    const settled = (result: ChunkResult): ChannelChunk => ({
      channelId,
      result,
    });
    if (state !== undefined && state.lastGeneratedThrough <= effectiveNow) {
      return this.#regenerateChunk(trx, state, effectiveNow, target);
    }
    const coverage = checkCoverage(state, target);
    if (coverage !== undefined) return settled(coverage);

    const anchorTime = state?.anchorTime ?? effectiveNow;
    const seed = state?.seed ?? deriveChannelSeed(channelId, anchorTime);
    const programmingSeed =
      state?.programmingSeed ?? deriveProgrammingSeed(channelId, anchorTime);
    const rebuildCount = state?.rebuildCount ?? 0;
    const written = await this.#writeChunk(
      trx,
      channelId,
      {
        seed,
        programmingSeed,
        rebuildCount,
        startsAt: state?.lastGeneratedThrough ?? anchorTime,
        nextSequenceNumber: state?.nextSequenceNumber ?? 0,
        recordsOrder: state === undefined,
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
      programmingSeed,
      rebuildCount,
      updatedAt: effectiveNow,
    };
    await (state === undefined
      ? createScheduleState(trx, next)
      : updateScheduleState(trx, next));
    return {
      ...settled(coverageAfterChunk(next, target)),
      revisionAdvanced: true,
    };
  }

  /**
   * Generates one bounded chunk toward `target` from the channel's
   * assignments, continuing its latest turn, and commits the new blocks,
   * their entries, and collection progress, and, when the chunk starts what
   * the schedule will air, the order each metadata mode followed. Leaves
   * schedule state to the caller, which alone knows whether the revision
   * advances.
   */
  async #writeChunk(
    trx: Kysely<DatabaseSchema>,
    channelId: string,
    start: ChunkStart,
    target: number,
    effectiveNow: number,
  ): Promise<WrittenChunk> {
    const { collections, ...inputs } = await loadProgrammingInputs(
      trx,
      channelId,
      start.startsAt,
    );
    const generated = generateProgramming({
      channelSeed: start.seed,
      programmingSeed: start.programmingSeed,
      rebuildCount: start.rebuildCount,
      ...inputs,
      timeZone: this.#programmingTimezone,
      startsAt: start.startsAt,
      through: target,
      nextSequenceNumber: start.nextSequenceNumber,
      maxEntries: this.#entriesPerTransaction,
      createBlockId: this.#createBlockId,
    });
    if (generated.kind === "unschedulable") return generated;

    await insertBlocks(trx, channelId, generated.blocks, effectiveNow);
    await insertEntries(
      trx,
      channelId,
      generated.entries,
      this.#createId,
      effectiveNow,
    );
    for (const progress of generated.progress) {
      await upsertProgress(trx, channelId, progress, effectiveNow);
    }
    if (start.recordsOrder) {
      for (const { members, ...scope } of collections) {
        const fingerprint = orderFingerprint(members, scope.playbackMode);
        if (fingerprint === null) continue;
        await recordOrderFingerprint(
          trx,
          { channelId, ...scope },
          fingerprint,
          effectiveNow,
        );
      }
    }
    return {
      kind: "written",
      lastGeneratedThrough: generated.generatedThrough,
      nextSequenceNumber: generated.nextSequenceNumber,
      insertedEntryCount: generated.entries.length,
    };
  }

  /**
   * Returns the first check that refuses generation for a channel (unknown,
   * disabled, or a target past the request limit) or its state, effective
   * time, and target. An input change passes its own effective time, which
   * already accounts for every channel's last mutation; otherwise the clock
   * is clamped to this channel's last mutation.
   */
  async #admit(
    trx: Kysely<DatabaseSchema>,
    channelId: string,
    log: ScheduleLog,
    through: number | undefined,
    inputTime?: number,
  ): Promise<ChannelAdmission | AdmissionFailure> {
    const enabled = await findChannelEnabled(trx, channelId);
    if (enabled === undefined) return { kind: "channel_not_found" };
    if (!enabled) return { kind: "disabled" };
    const state = await loadScheduleState(trx, channelId);
    const effectiveNow =
      inputTime ??
      clampToLastMutation(this.#now(), state?.updatedAt, log, { channelId });
    const target = resolveTarget(effectiveNow, through);
    if (typeof target !== "number") return target;
    return { kind: "admitted", state, effectiveNow, target };
  }

  /** Runs `work` holding write authority, with the hooks every mutation shares. */
  #immediate<T>(work: (trx: Kysely<DatabaseSchema>) => Promise<T>): Promise<T> {
    return runImmediateTransaction(this.#db, work, {
      hooks: this.#transactionHooks,
    });
  }
}

/**
 * Loads everything kraziPlan reads from storage for a channel generating
 * from `startsAt`. Without `keptBefore` it reads the state as stored, as
 * generation continues it; with it, it reads what a regeneration from that
 * boundary would keep: the latest turn and aired totals before it, and the
 * progress the entries from it would restore to. Only reservations ending
 * after the latest turn began can still matter to generation.
 */
async function loadProgrammingInputs(
  trx: Kysely<DatabaseSchema>,
  channelId: string,
  startsAt: number,
  keptBefore?: number,
) {
  const assignments = await loadProgrammingAssignments(trx, channelId);
  const latestTurn = await loadLatestTurn(trx, channelId, keptBefore);
  const reservations = await loadReservations(
    trx,
    channelId,
    Math.min(latestTurn?.block.startsAt ?? startsAt, startsAt),
  );
  const collections = [
    ...assignedCollections(assignments),
    ...reservedCollections(reservations),
  ];
  const stored = await loadProgress(trx, channelId, collections);
  const restored =
    keptBefore === undefined
      ? []
      : await readRestoredProgress(
          trx,
          channelId,
          await listRestorableEntriesFrom(trx, channelId, keptBefore),
          keptBefore,
        );
  const key = (entry: CollectionProgress) =>
    `${entry.mediaCollectionId}\u0000${entry.playbackMode}`;
  const restoredKeys = new Set(restored.map(key));
  return {
    assignments,
    rules: await loadProgrammingRules(trx, channelId),
    reservations,
    collections,
    marathons: await loadMarathonSettings(trx, channelId),
    latestTurn,
    progress: [
      ...stored.filter((entry) => !restoredKeys.has(key(entry))),
      ...restored,
    ],
  };
}

/**
 * Lists each collection the reservations play, with its mode and members,
 * because a collection reservation consumes the same progress a generated
 * turn does and its order is the one the schedule follows.
 */
function reservedCollections(reservations: readonly Reservation[]) {
  return reservations.flatMap(({ source }) =>
    source.kind === "collection"
      ? [
          {
            mediaCollectionId: source.mediaCollectionId,
            playbackMode: source.playbackMode,
            members: source.members,
          },
        ]
      : [],
  );
}

/**
 * Lists each collection the assignments play, with the mode its assignment
 * plays it in and its members, so generation loads their progress and a
 * new schedule records the order each metadata mode follows.
 */
function assignedCollections(assignments: readonly ProgrammingAssignment[]) {
  return assignments.flatMap(({ playbackMode, members }) =>
    playbackMode === null
      ? []
      : members.flatMap((member) =>
          member.kind === "collection"
            ? [
                {
                  mediaCollectionId: member.mediaCollectionId,
                  playbackMode,
                  members: member.members,
                },
              ]
            : [],
        ),
  );
}
