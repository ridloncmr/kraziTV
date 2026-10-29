import {
  deriveChannelSeed,
  deriveProgrammingSeed,
  findRegenerationBoundary,
  generateProgramming,
  type Reservation,
  SCHEDULE_HORIZON_MS,
} from "@krazitv/krazi-brain";
import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import {
  findAiringItem,
  readGuideEntries,
  readTimeline,
} from "../../playout/persistence/playout-reads.js";
import type {
  PreviewSettings,
  ReservationPreview,
  ReservationRefusal,
} from "../../reservations/contracts.js";
import { resolvePreviewSettings } from "../../reservations/persistence/preview-settings.js";
import { resolveReservationRange } from "../../reservations/persistence/reservation-refusals.js";
import { resolveReservation } from "../../reservations/persistence/reservation-rows.js";
import type {
  CollectionPreview,
  ProgrammingPreview,
  ScheduleLog,
  ScheduleState,
  ScheduleWindow,
} from "../contracts.js";
import {
  findAssignedCollectionMode,
  loadCollectionMembers,
  loadConfigurationRevision,
} from "../persistence/assignment-sources.js";
import { loadProgrammingInputs } from "../persistence/programming-inputs.js";
import {
  findChannelEnabled,
  listUpcomingCollectionEntries,
  loadScheduleState,
} from "../persistence/schedule-repository.js";
import { clampToLastMutation } from "../schedule-coverage.js";

// Bounds one programming preview, as a transaction bounds one chunk.
const PREVIEW_MAX_ENTRIES = 2000;

// Names the reservation a preview adds, which is never saved.
const PREVIEW_RESERVATION_ID = "preview-reservation";

// How many upcoming selections a collection preview shows.
const PREVIEW_UPCOMING_ENTRIES = 10;

/**
 * The read side of schedules: schedule windows and the previews that show
 * what a regeneration would generate. Every read runs in one deferred
 * snapshot and never writes, so it never takes write authority from the
 * schedule writer. Built on the writer's clock and programming timezone, so
 * a preview evaluates the same time and rules a write would.
 */
export class SchedulePreview {
  readonly #db: Kysely<DatabaseSchema>;
  readonly #now: () => number;
  readonly #timeZone: string;

  // All three are required, so a preview can never fall back to a clock or
  // timezone the schedule writer does not use.
  constructor(db: Kysely<DatabaseSchema>, now: () => number, timeZone: string) {
    this.#db = db;
    this.#now = now;
    this.#timeZone = timeZone;
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
    previewed: PreviewSettings,
    log: ScheduleLog,
  ): Promise<ReservationPreview> {
    return this.#previewSnapshot(
      channelId,
      log,
      async (trx, state, effectiveNow) => {
        const scheduleRevision = state?.scheduleRevision ?? null;
        const programmingRevision = state?.programmingRevision ?? null;
        // Both refusals carry the revisions read in this snapshot.
        const refused = (refusal: ReservationRefusal): ReservationPreview => ({
          kind: "refused",
          refusal,
          scheduleRevision,
          programmingRevision,
        });
        const asked = await resolvePreviewSettings(trx, previewed);
        if (asked.kind === "refused") return refused(asked.refusal);
        const { settings, replacesReservationId, resolvedMediaItemIds } = asked;
        const range = await resolveReservationRange(
          trx,
          channelId,
          settings,
          effectiveNow,
          replacesReservationId,
        );
        if (range.kind !== "resolved") return refused(range);
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
            replacesReservationId,
          );
        if (generated.kind === "unschedulable") {
          return { ...generated, scheduleRevision, programmingRevision };
        }
        return {
          kind: "preview",
          scheduleRevision,
          programmingRevision,
          startsAt: reservation.startsAt,
          endsAt: reservation.endsAt,
          endKind: range.endKind,
          // Coverage read in the preview's own snapshot; none yet means the
          // first save plans everything, so nothing is planned already.
          beyondHorizon:
            reservation.startsAt >=
            (state?.lastGeneratedThrough ?? effectiveNow),
          sourceKind: settings.source.kind,
          ...(resolvedMediaItemIds === undefined
            ? {}
            : { mediaItemIds: resolvedMediaItemIds }),
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
   * one is given, in place of `replaced` for an edit, and generating
   * through at least its end. The one generator both previews share; it
   * never writes.
   */
  async #previewGeneration(
    trx: Kysely<DatabaseSchema>,
    channelId: string,
    state: ScheduleState | undefined,
    effectiveNow: number,
    added?: Reservation,
    replaced?: string,
  ) {
    // An unsaved interrupting reservation cuts what airs at its start
    // (ADR 0015); a save refuses any other that starts before the boundary.
    const boundary = Math.min(
      findRegenerationBoundary(
        await findAiringItem(trx, channelId, effectiveNow, {
          ...(replaced === undefined ? {} : { excludeReservationId: replaced }),
        }),
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
    const kept = stored.reservations.filter(
      (reservation) => reservation.id !== replaced,
    );
    const inputs =
      added === undefined
        ? stored
        : { ...stored, reservations: [...kept, added] };
    const anchorTime = state?.anchorTime ?? effectiveNow;
    let previewed = 0;
    const generated = generateProgramming({
      channelSeed: state?.seed ?? deriveChannelSeed(channelId, anchorTime),
      programmingSeed:
        state?.programmingSeed ?? deriveProgrammingSeed(channelId, anchorTime),
      rebuildCount: state?.rebuildCount ?? 0,
      ...inputs,
      timeZone: this.#timeZone,
      startsAt: boundary,
      through: Math.max(boundary + SCHEDULE_HORIZON_MS, added?.endsAt ?? 0),
      nextSequenceNumber: state?.nextSequenceNumber ?? 0,
      maxEntries: PREVIEW_MAX_ENTRIES,
      createBlockId: () => `preview-${(previewed += 1)}`,
    });
    return { boundary, inputs, reservations: inputs.reservations, generated };
  }
}
