import {
  type AiringSpan,
  buildPlayoutTimeline,
  type ChannelState,
  cutAtReservations,
  deriveChannelState,
  findAiringAt,
  type FollowingPlayout,
  type PlayoutCursor,
  type PlayoutEntry,
  type PlayoutItem,
  selectFollowingPlayout,
} from "@krazitv/krazi-brain";
import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import type { ScheduleEntry } from "../../schedules/contracts.js";
import {
  listEntriesInWindow,
  loadScheduleState,
} from "../../schedules/persistence/schedule-repository.js";
import {
  findInterruptionStart,
  findPlayoutEntryById,
  listPlayoutEntriesAround,
  listPlayoutEntriesInWindow,
  listReservedTimeRanges,
} from "./playout-repository.js";

// Each read loads exactly what kraziBrain's filler and cut derivation needs
// (ADR 0014, ADR 0015) through the caller's executor: a deferred snapshot for
// playout reads, or the transition coordinator's immediate transaction, so
// both answer what airs from the same rows. No read here, and no read
// elsewhere, finds an entry by instant in SQL alone: a cut entry and the
// reservation that cut it both cover the instants after the cut in storage.

type Executor = Kysely<DatabaseSchema>;

/** The schedule a read is answered under: its channel, revision, and anchor. */
interface PlayoutReadScope {
  channelId: string;
  scheduleRevision: number;
  /** Where planned filler with no earlier program starts. */
  anchorTime: number;
}

/**
 * Derives what the channel transmits at `at`, a program or planned filler,
 * from the entry around it, the next one, and the reservations still to end.
 */
export async function readChannelStateAt(
  trx: Executor,
  scope: PlayoutReadScope,
  at: number,
): Promise<ChannelState> {
  const entries = await listPlayoutEntriesAround(trx, scope.channelId, at, 1);
  return deriveChannelState({
    ...scope,
    reservations: await listRangesFor(trx, scope.channelId, at, entries),
    evaluatedAt: at,
    entries,
  });
}

/**
 * Selects up to `count` contiguous items after the cursor. A program cursor
 * reads from its entry; a filler cursor from its last instant, which names
 * it. One entry past the count lets the last filler find its end.
 */
export async function readFollowing(
  trx: Executor,
  scope: PlayoutReadScope,
  cursor: PlayoutCursor,
  count: number,
): Promise<FollowingPlayout> {
  const at =
    cursor.kind === "program"
      ? (
          await findPlayoutEntryById(
            trx,
            scope.channelId,
            cursor.scheduleEntryId,
          )
        )?.startsAt
      : cursor.endsAt - 1;
  const entries =
    at === undefined
      ? []
      : await listPlayoutEntriesAround(trx, scope.channelId, at, count + 1);
  return selectFollowingPlayout({
    ...scope,
    reservations:
      at === undefined
        ? []
        : await listRangesFor(trx, scope.channelId, at, entries),
    cursor,
    entries,
    count,
  });
}

/**
 * Lists everything the channel transmits overlapping `[start, end)`,
 * programs and planned filler, from the entries in the window and the one
 * on each side of it.
 */
export async function readTimeline(
  trx: Executor,
  scope: PlayoutReadScope,
  start: number,
  end: number,
): Promise<PlayoutItem[]> {
  const byId = new Map<string, PlayoutEntry>();
  for (const entry of [
    ...(await listPlayoutEntriesAround(trx, scope.channelId, start, 1)),
    ...(await listPlayoutEntriesInWindow(trx, scope.channelId, start, end)),
    ...(await listPlayoutEntriesAround(trx, scope.channelId, end - 1, 1)),
  ]) {
    byId.set(entry.id, entry);
  }
  const entries = [...byId.values()].sort((a, b) => a.startsAt - b.startsAt);
  return buildPlayoutTimeline({
    ...scope,
    reservations: await listRangesFor(trx, scope.channelId, start, entries),
    window: { start, end },
    entries,
  });
}

/**
 * Lists the guide-visible entries airing in `[start, end)` in start order,
 * each ending at its cut, so the schedule window and XMLTV show a program an
 * interrupting reservation cut ending there (ADR 0015).
 */
export async function readGuideEntries(
  trx: Executor,
  channelId: string,
  start: number,
  end: number,
): Promise<ScheduleEntry[]> {
  const stored = await listEntriesInWindow(trx, channelId, start, end);
  const cut = cutAtReservations(
    stored,
    await listRangesFor(trx, channelId, start, stored),
  );
  return cut.filter((entry) => entry.endsAt > start);
}

/**
 * Finds what holds the airtime at `at`, a program or planned filler, with
 * its cut: what transition revalidation and an interruption read. Undefined
 * in an unexplained gap or on a channel with no schedule. A write that
 * replaces a reservation passes its ID as `excludeReservationId`, so neither
 * its range nor its stored programs hide what airs without it.
 */
export async function readAiringAt(
  trx: Executor,
  channelId: string,
  at: number,
  { excludeReservationId }: { excludeReservationId?: string } = {},
): Promise<AiringSpan | undefined> {
  const state = await loadScheduleState(trx, channelId);
  if (state === undefined) return undefined;
  const entries = await listPlayoutEntriesAround(
    trx,
    channelId,
    at,
    1,
    excludeReservationId,
  );
  return findAiringAt({
    channelId,
    scheduleRevision: state.scheduleRevision,
    anchorTime: state.anchorTime,
    reservations: await listRangesFor(
      trx,
      channelId,
      at,
      entries,
      excludeReservationId,
    ),
    at,
    entries,
  });
}

/**
 * Finds the playout item airing at `at`, a program or planned filler,
 * whose end is where regeneration may rebuild from: nothing airing is ever
 * changed by a routine edit (ADR 0003, ADR 0014). A program cut by an
 * interrupting reservation ends at the cut (ADR 0015). Nothing airs at the
 * instant an interrupting reservation starts: everything stored from then on
 * is its programming or what it displaced, all of it regenerable, as when one
 * starting now cuts an entry that itself only starts now. Airing
 * filler ends where an interrupting reservation starts inside it: before
 * that reservation's programs are generated, derivation would merge the
 * filler across it. Filler at or past the end of coverage is not airing
 * either: that time was never generated, so a reservation ahead only makes
 * lapsed coverage look planned, and gap repair must rebuild from now rather
 * than from past the reservation.
 */
export async function findAiringItem(
  trx: Executor,
  channelId: string,
  at: number,
  options: { excludeReservationId?: string } = {},
): Promise<
  { kind: "program" | "filler"; startsAt: number; endsAt: number } | undefined
> {
  const { excludeReservationId } = options;
  const startsNow = await findInterruptionStart(
    trx,
    channelId,
    at,
    at,
    excludeReservationId,
  );
  if (startsNow !== undefined) return undefined;
  const airing = await readAiringAt(trx, channelId, at, options);
  if (airing === undefined) return undefined;
  if (airing.kind === "filler") {
    const state = await loadScheduleState(trx, channelId);
    if (state !== undefined && at >= state.lastGeneratedThrough) {
      return undefined;
    }
  }
  const cutAt =
    airing.kind === "filler"
      ? await findInterruptionStart(
          trx,
          channelId,
          at + 1,
          airing.endsAt - 1,
          excludeReservationId,
        )
      : undefined;
  return {
    kind: airing.kind,
    startsAt: airing.startsAt,
    endsAt: cutAt ?? airing.endsAt,
  };
}

/**
 * Lists the reservation ranges a read of `entries` from `at` needs: every
 * one ending after the earliest instant either names, so filler from `at` on
 * is explained and a reservation ended early still cuts its own program.
 */
async function listRangesFor(
  trx: Executor,
  channelId: string,
  at: number,
  entries: readonly { startsAt: number }[],
  excludeReservationId?: string,
) {
  const after = Math.min(at, ...entries.map((entry) => entry.startsAt));
  return listReservedTimeRanges(trx, channelId, after, excludeReservationId);
}
