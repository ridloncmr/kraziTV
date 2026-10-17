import { randomUUID } from "node:crypto";

import type { Kysely } from "kysely";

import { toSqliteBoolean } from "../../database/columns/sqlite-boolean.js";
import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import type { RecordSources } from "../../database/writes/record-sources.js";
import { loadScheduleState } from "../../schedules/persistence/schedule-repository.js";
import {
  findAiringItem,
  readAiringAt,
} from "../../playout/persistence/playout-reads.js";
import type {
  CreateReservationResult,
  DeleteReservationResult,
  EarlyEnd,
  SaveGuards,
  EndReservationResult,
  ReservationRefusal,
  ReservationSettings,
  SavedReservation,
  UpdateReservationResult,
} from "../contracts.js";
import { resolveReservationRange } from "./reservation-refusals.js";
import {
  readReservations,
  settleAiredCuts,
  toSourceColumns,
  writeReservationItems,
} from "./reservation-rows.js";

type Executor = Kysely<DatabaseSchema>;

/**
 * Persists reservations and the media items they list. Writes take the
 * caller's pinned executor and effective time because they run only inside
 * a schedule input change, whose regeneration commits in the same
 * immediate transaction, so a reservation is never saved without the
 * schedule that honors it.
 */
export class ReservationRepository {
  readonly #db: Kysely<DatabaseSchema>;
  readonly #createId: () => string;

  // The ID source is injectable so tests can assert exact IDs.
  constructor(
    db: Kysely<DatabaseSchema>,
    options: Pick<RecordSources, "createId"> = {},
  ) {
    this.#db = db;
    this.#createId = options.createId ?? randomUUID;
  }

  /** Lists a channel's reservations in start order; an unknown channel simply has none. */
  async listForChannel(channelId: string): Promise<SavedReservation[]> {
    return readReservations(this.#db, channelId);
  }

  /**
   * Saves a new reservation once every check in `resolveReservationRange`
   * passes. A save whose key already created one returns it unchanged, so a
   * retry duplicates nothing; the key names the save, so a retry's body is
   * not compared, as for a fresh rebuild's key. Any other save made from a
   * preview of another schedule revision is refused before it writes.
   */
  async create(
    trx: Executor,
    channelId: string,
    settings: ReservationSettings,
    guards: SaveGuards,
    now: number,
  ): Promise<CreateReservationResult> {
    const channel = await trx
      .selectFrom("channels")
      .select("id")
      .where("id", "=", channelId)
      .executeTakeFirst();
    if (channel === undefined) return { kind: "channel_not_found" };
    if (guards.requestKey !== undefined) {
      const [repeated] = await readReservations(trx, channelId, {
        requestKey: guards.requestKey,
      });
      if (repeated !== undefined) {
        return { kind: "repeated", reservation: repeated };
      }
    }
    const stale = await findStalePreview(trx, channelId, guards);
    if (stale !== undefined) return stale;
    const range = await resolveReservationRange(trx, channelId, settings, now);
    if (range.kind !== "resolved") return range;
    const id = this.#createId();
    await trx
      .insertInto("reservations")
      .values({
        id,
        channel_id: channelId,
        starts_at: range.startsAt,
        ends_at: range.endsAt,
        end_kind: range.endKind,
        interrupts: toSqliteBoolean(range.interrupts),
        request_key: guards.requestKey ?? null,
        ...toSourceColumns(settings.source),
        created_at: now,
        updated_at: now,
      })
      .execute();
    await writeReservationItems(trx, id, settings.source);
    return {
      kind: "created",
      reservation: await readReservation(trx, channelId, id),
    };
  }

  /**
   * Replaces a reservation that has not started; one owned by another
   * channel is not found. A started one is refused, because editing it
   * would change what is airing. Identical settings write
   * nothing and report `unchanged`, so callers can skip regeneration.
   */
  async update(
    trx: Executor,
    channelId: string,
    reservationId: string,
    settings: ReservationSettings,
    guards: SaveGuards,
    now: number,
  ): Promise<UpdateReservationResult> {
    const [current] = await readReservations(trx, channelId, { reservationId });
    if (current === undefined) return { kind: "not_found" };
    if (current.startsAt <= now) {
      return { kind: "reservation_started", startsAt: current.startsAt };
    }
    if (isSameSettings(current, settings)) {
      return { kind: "unchanged", reservation: current };
    }
    const stale = await findStalePreview(trx, channelId, guards);
    if (stale !== undefined) return stale;
    const conflict = await findAiringFillerConflict(trx, current, now);
    if (conflict !== undefined) return conflict;
    const range = await resolveReservationRange(
      trx,
      channelId,
      settings,
      now,
      reservationId,
    );
    if (range.kind !== "resolved") return range;
    await trx
      .updateTable("reservations")
      .set({
        starts_at: range.startsAt,
        ends_at: range.endsAt,
        end_kind: range.endKind,
        interrupts: toSqliteBoolean(range.interrupts),
        ...toSourceColumns(settings.source),
        updated_at: now,
      })
      .where("id", "=", reservationId)
      .execute();
    await writeReservationItems(trx, reservationId, settings.source);
    return {
      kind: "updated",
      reservation: await readReservation(trx, channelId, reservationId),
    };
  }

  /**
   * Ends a running reservation early by moving its end earlier, the only
   * change a started one takes (programming spec 0007). Letting the airing
   * program finish ends it with that program, or now during its filler; a
   * chosen instant must fall from now through the current end, and inside
   * a program it cuts that program there (ADR 0015). The end becomes
   * explicit; an end that does not move writes nothing.
   */
  async endEarly(
    trx: Executor,
    channelId: string,
    reservationId: string,
    end: EarlyEnd,
    now: number,
  ): Promise<EndReservationResult> {
    const [current] = await readReservations(trx, channelId, { reservationId });
    if (current === undefined) return { kind: "not_found" };
    if (current.startsAt > now) {
      return { kind: "reservation_not_started", startsAt: current.startsAt };
    }
    if (current.endsAt <= now) {
      return { kind: "reservation_ended", endsAt: current.endsAt };
    }
    const earliestEndsAt = Math.max(now, current.startsAt + 1);
    const endsAt =
      "endsAt" in end
        ? end.endsAt
        : await findAiringProgramEnd(trx, current, now);
    if (endsAt < earliestEndsAt || endsAt > current.endsAt) {
      return {
        kind: "reservation_end_out_of_range",
        earliestEndsAt,
        latestEndsAt: current.endsAt,
      };
    }
    if (endsAt === current.endsAt) {
      return { kind: "unchanged", reservation: current };
    }
    await trx
      .updateTable("reservations")
      .set({ ends_at: endsAt, end_kind: "explicit", updated_at: now })
      .where("id", "=", reservationId)
      .execute();
    return {
      kind: "ended",
      reservation: await readReservation(trx, channelId, reservationId),
    };
  }

  /**
   * Deletes a reservation; one owned by another channel is not found, and
   * one the airing filler leads into is refused. Its block stays as
   * history, and regeneration after what airs returns its range to ordinary
   * programming.
   */
  async delete(
    trx: Executor,
    channelId: string,
    reservationId: string,
    now: number,
  ): Promise<DeleteReservationResult> {
    const [current] = await readReservations(trx, channelId, { reservationId });
    if (current === undefined) return { kind: "not_found" };
    const conflict = await findAiringFillerConflict(trx, current, now);
    if (conflict !== undefined) return conflict;
    await settleAiredCuts(trx, [current], now);
    const deleted = await trx
      .deleteFrom("reservations")
      .where("id", "=", reservationId)
      .where("channel_id", "=", channelId)
      .executeTakeFirst();
    return deleted.numDeletedRows > 0n
      ? { kind: "deleted" }
      : { kind: "not_found" };
  }
}

/**
 * Returns a refusal when planned filler airing at `now` depends on the
 * reservation, by leading into it or covering part of its range: changing
 * or removing it would change the airing filler's end and on-screen resume
 * time, which routine edits never do (programming spec 0006, ADR 0014). An
 * interrupting reservation that has not started cuts the airing item, which
 * was the owner's explicit choice to move that end (ADR 0015), so editing or
 * cancelling one is never refused here.
 */
async function findAiringFillerConflict(
  trx: Executor,
  reservation: SavedReservation,
  now: number,
): Promise<
  Extract<ReservationRefusal, { kind: "airing_filler_conflict" }> | undefined
> {
  if (reservation.interrupts && reservation.startsAt > now) return undefined;
  const airing = await findAiringItem(trx, reservation.channelId, now);
  if (
    airing?.kind === "filler" &&
    reservation.startsAt <= airing.endsAt &&
    airing.startsAt < reservation.endsAt
  ) {
    return { kind: "airing_filler_conflict", fillerEndsAt: airing.endsAt };
  }
  return undefined;
}

/**
 * Returns a refusal when the channel's schedule revision is not the one the
 * save's preview read, so a save never publishes a schedule the owner did
 * not see. Read inside the write's immediate transaction. Coverage extended
 * by an ordinary read since the preview also makes it stale: it fails
 * closed, and the owner previews again. The refusal names no revision, so a
 * browser can only recover by previewing, never by resending.
 */
async function findStalePreview(
  trx: Executor,
  channelId: string,
  { expectedScheduleRevision }: SaveGuards,
): Promise<Extract<ReservationRefusal, { kind: "preview_stale" }> | undefined> {
  const scheduleRevision =
    (await loadScheduleState(trx, channelId))?.scheduleRevision ?? null;
  return scheduleRevision === expectedScheduleRevision
    ? undefined
    : { kind: "preview_stale" };
}

/**
 * Returns when the program airing inside a running reservation ends, or
 * `now` when its filler airs or nothing of it does, so letting what airs
 * finish never runs the reservation past that program.
 */
async function findAiringProgramEnd(
  trx: Executor,
  reservation: SavedReservation,
  now: number,
): Promise<number> {
  const airing = await readAiringAt(trx, reservation.channelId, now);
  return airing?.kind === "program" &&
    airing.startsAt >= reservation.startsAt &&
    airing.endsAt <= reservation.endsAt
    ? airing.endsAt
    : now;
}

// Reads back the reservation a write just saved, which must exist.
async function readReservation(
  trx: Executor,
  channelId: string,
  reservationId: string,
): Promise<SavedReservation> {
  const [reservation] = await readReservations(trx, channelId, {
    reservationId,
  });
  if (reservation === undefined) {
    throw new Error(`reservation ${reservationId} was not saved`);
  }
  return reservation;
}

// Whether saving `settings` would leave the reservation as it is: the same
// start, source, end, and interrupting choice, with a program-derived end
// matching a null one. A start of "now" is never the saved one: the saved
// reservation has not started, so it starts later.
function isSameSettings(
  current: SavedReservation,
  settings: ReservationSettings,
): boolean {
  const sameEnd =
    settings.endsAt === null
      ? current.endKind === "program_derived"
      : current.endKind === "explicit" && current.endsAt === settings.endsAt;
  return (
    current.startsAt === settings.startsAt &&
    current.interrupts === settings.interrupts &&
    sameEnd &&
    JSON.stringify(current.source) === JSON.stringify(settings.source)
  );
}
