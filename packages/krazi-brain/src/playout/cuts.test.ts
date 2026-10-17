import { describe, expect, it } from "vitest";

import { playoutEntry } from "../testing/playout-entries.js";
import { deriveChannelState } from "./channel-state.js";
import type {
  PlayoutCursor,
  PlayoutEntry,
  ReservedTimeRange,
} from "./contracts.js";
import { listPlannedFiller } from "./filler.js";
import { selectFollowingPlayout } from "./following-playout.js";
import { buildPlayoutTimeline } from "./playout-item.js";

const MINUTE_MS = 60_000;
const CHANNEL_ID = "channel_69";
const SCHEDULE_REVISION = 9;
// 2026-10-16T19:30:00.000Z; every instant below is minutes after it.
const T0 = Date.parse("2026-10-16T19:30:00.000Z");
const at = (minutes: number) => T0 + minutes * MINUTE_MS;

// An entry stored as airing `[from, to)` minutes, with media filling it.
function entry(id: string, from: number, to: number): PlayoutEntry {
  return playoutEntry(id, {
    startsAt: at(from),
    endsAt: at(to),
    media: { durationMs: (to - from) * MINUTE_MS },
  });
}

const range = (from: number, to: number): ReservedTimeRange => ({
  startsAt: at(from),
  endsAt: at(to),
});

// 7:30 PM: an episode stored to 8:05 airs; the owner cut it with a special
// at 7:45 whose two programs run to 8:45, then ordinary programming
// regenerated from the special's end.
const EPISODE = entry("episode", 0, 35);
const SPECIAL_1 = entry("special-1", 15, 45);
const SPECIAL_2 = entry("special-2", 45, 75);
const AFTER = entry("after", 75, 105);
const CUT = [EPISODE, SPECIAL_1, SPECIAL_2, AFTER];
const INTERRUPTING = [range(15, 75)];

const inputs = (reservations: readonly ReservedTimeRange[]) => ({
  channelId: CHANNEL_ID,
  scheduleRevision: SCHEDULE_REVISION,
  reservations,
  anchorTime: at(0),
});

function stateAt(
  minutes: number,
  entries: readonly PlayoutEntry[] = CUT,
  reservations: readonly ReservedTimeRange[] = INTERRUPTING,
) {
  return deriveChannelState({
    ...inputs(reservations),
    evaluatedAt: at(minutes),
    entries,
  });
}

function timeline(
  entries: readonly PlayoutEntry[] = CUT,
  reservations: readonly ReservedTimeRange[] = INTERRUPTING,
) {
  return buildPlayoutTimeline({
    ...inputs(reservations),
    window: { start: at(0), end: at(105) },
    entries,
  }).map((item) => [
    item.type === "program" ? item.scheduleEntryId : "filler",
    (item.startsAt - T0) / MINUTE_MS,
    (item.endsAt - T0) / MINUTE_MS,
  ]);
}

function followingAfter(
  cursor: PlayoutCursor,
  entries: readonly PlayoutEntry[] = CUT,
  reservations: readonly ReservedTimeRange[] = INTERRUPTING,
) {
  return selectFollowingPlayout({
    ...inputs(reservations),
    cursor,
    entries,
    count: 1,
  });
}

describe("cuts at reservation boundaries (ADR 0015)", () => {
  it("ends an entry crossing an interrupting reservation's start there, with the special right after", () => {
    expect(timeline()).toEqual([
      ["episode", 0, 15],
      ["special-1", 15, 45],
      ["special-2", 45, 75],
      ["after", 75, 105],
    ]);
    expect(
      listPlannedFiller({
        ...inputs(INTERRUPTING),
        window: { start: at(0), end: at(105) },
        entries: CUT,
      }),
    ).toEqual([]);
    const following = followingAfter({
      kind: "program",
      scheduleEntryId: "episode",
    });
    expect(following.items.map((item) => item.startsAt)).toEqual([at(15)]);
    expect(following.items[0]).toMatchObject({
      scheduleEntryId: "special-1",
    });
  });

  it("joins a cut entry at its unchanged offset before the cut, ending at the cut", () => {
    const state = stateAt(10);

    expect(state.currentItem).toMatchObject({
      scheduleEntryId: "episode",
      startsAt: at(0),
      endsAt: at(15),
      offsetMs: 10 * MINUTE_MS,
    });
    expect(state.nextItem).toMatchObject({ scheduleEntryId: "special-1" });
  });

  it("never reports the cut entry once the special airs", () => {
    for (const minutes of [15, 20, 34]) {
      expect(stateAt(minutes).currentItem).toMatchObject({
        scheduleEntryId: "special-1",
        offsetMs: (minutes - 15) * MINUTE_MS,
      });
    }
  });

  it("ends a running special's airing program at its moved end, with ordinary programming after", () => {
    // Ended early at 8:00, inside special-1 (7:45 to 8:15); regeneration
    // deleted special-2 and rebuilt ordinary programming from 8:00.
    const ended = [range(15, 30)];
    const entries = [EPISODE, SPECIAL_1, entry("resumed", 30, 60)];

    expect(timeline(entries, ended)).toEqual([
      ["episode", 0, 15],
      ["special-1", 15, 30],
      ["resumed", 30, 60],
    ]);
    expect(stateAt(29, entries, ended).currentItem).toMatchObject({
      scheduleEntryId: "special-1",
      endsAt: at(30),
    });
    expect(stateAt(30, entries, ended).currentItem).toMatchObject({
      scheduleEntryId: "resumed",
    });
    expect(
      followingAfter(
        { kind: "program", scheduleEntryId: "special-1" },
        entries,
        ended,
      ).items[0],
    ).toMatchObject({ scheduleEntryId: "resumed", startsAt: at(30) });
  });

  it("cuts an airing filler at an interrupting reservation's start", () => {
    // Filler before a reservation at 8:30 airs from 7:30; a special cut in
    // at 7:45 and runs to 8:15.
    const reservations = [range(15, 45), range(60, 90)];
    const entries = [entry("special", 15, 45), entry("reserved", 60, 90)];
    const state = deriveChannelState({
      ...inputs(reservations),
      anchorTime: at(-30),
      evaluatedAt: at(10),
      entries,
    });

    expect(state.currentItem).toMatchObject({
      type: "filler",
      endsAt: at(15),
    });
  });

  it("restores the entry's full airtime once the reservation is gone", () => {
    expect(timeline([EPISODE, entry("next", 35, 65)], [])).toEqual([
      ["episode", 0, 35],
      ["next", 35, 65],
    ]);
    expect(stateAt(20, [EPISODE], []).currentItem).toMatchObject({
      scheduleEntryId: "episode",
      endsAt: at(35),
    });
  });
});
