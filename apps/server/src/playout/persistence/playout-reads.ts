import {
  buildPlayoutTimeline,
  type ChannelState,
  deriveChannelState,
  type FollowingPlayout,
  type PlayoutCursor,
  type PlayoutEntry,
  type PlayoutItem,
  selectFollowingPlayout,
} from "@krazitv/krazi-brain";
import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import {
  findPlayoutEntryById,
  listPlayoutEntriesAround,
  listPlayoutEntriesInWindow,
  listReservedTimeRanges,
} from "./playout-repository.js";

// Each read loads exactly what kraziBrain's filler derivation needs (ADR
// 0014) through the caller's executor: a deferred snapshot for playout
// reads, or the transition coordinator's immediate transaction, so both
// answer what airs from the same rows.

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
  return deriveChannelState({
    ...scope,
    reservations: await listReservedTimeRanges(trx, scope.channelId, at),
    evaluatedAt: at,
    entries: await listPlayoutEntriesAround(trx, scope.channelId, at, 1),
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
  return selectFollowingPlayout({
    ...scope,
    reservations:
      at === undefined
        ? []
        : await listReservedTimeRanges(trx, scope.channelId, at),
    cursor,
    entries:
      at === undefined
        ? []
        : await listPlayoutEntriesAround(trx, scope.channelId, at, count + 1),
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
  return buildPlayoutTimeline({
    ...scope,
    reservations: await listReservedTimeRanges(trx, scope.channelId, start),
    window: { start, end },
    entries: [...byId.values()].sort((a, b) => a.startsAt - b.startsAt),
  });
}
