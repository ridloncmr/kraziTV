import { describe, expect, it } from "vitest";

import { playoutEntry } from "../testing/playout-entries.js";
import { deriveChannelState } from "./channel-state.js";
import type {
  PlayoutCursor,
  PlayoutEntry,
  ReservedTimeRange,
} from "./contracts.js";
import { selectFollowingPlayout } from "./following-playout.js";
import { buildPlayoutTimeline } from "./playout-item.js";

const MINUTE_MS = 60_000;
const CHANNEL_ID = "channel_69";
const SCHEDULE_REVISION = 7;
// 2026-09-28T20:00:00.000Z; every instant below is minutes after it.
const T0 = Date.parse("2026-09-28T20:00:00.000Z");
const at = (minutes: number) => T0 + minutes * MINUTE_MS;

// An entry airing `[from, to)` minutes, with media filling its airtime.
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

// Two programs, then a reservation at 75 whose 30-minute program leaves its
// explicit end at 120 unused, then ordinary programming again.
const BEFORE = [entry("p0", 0, 30), entry("p1", 30, 60)];
const RESERVED = entry("r0", 75, 105);
const AFTER = entry("p2", 120, 150);
const ENTRIES = [...BEFORE, RESERVED, AFTER];
const RESERVATIONS = [range(75, 120)];

function stateAt(
  minutes: number,
  entries: readonly PlayoutEntry[] = ENTRIES,
  reservations: readonly ReservedTimeRange[] = RESERVATIONS,
  anchorTime = at(0),
) {
  return deriveChannelState({
    channelId: CHANNEL_ID,
    scheduleRevision: SCHEDULE_REVISION,
    evaluatedAt: at(minutes),
    entries,
    reservations,
    anchorTime,
  });
}

function followingAfter(
  cursor: PlayoutCursor,
  count: number,
  entries: readonly PlayoutEntry[] = ENTRIES,
) {
  return selectFollowingPlayout({
    channelId: CHANNEL_ID,
    scheduleRevision: SCHEDULE_REVISION,
    cursor,
    entries,
    reservations: RESERVATIONS,
    anchorTime: at(0),
    count,
  });
}

const filler = (from: number, to: number) => ({
  type: "filler" as const,
  channelId: CHANNEL_ID,
  scheduleRevision: SCHEDULE_REVISION,
  startsAt: at(from),
  endsAt: at(to),
});

// Each item as `<entry ID or filler>@<from>-<to>` in minutes.
function shape(
  items: readonly ({ startsAt: number; endsAt: number } & (
    { type: "filler" } | { type: "program"; scheduleEntryId: string }
  ))[],
): string[] {
  return items.map(
    (item) =>
      `${item.type === "program" ? item.scheduleEntryId : "filler"}@${(item.startsAt - T0) / MINUTE_MS}-${(item.endsAt - T0) / MINUTE_MS}`,
  );
}

describe("planned filler", () => {
  it("transmits filler before a reservation, joined at its offset, ending where its program starts", () => {
    const state = stateAt(70);

    expect(state).toMatchObject({
      kind: "current",
      currentItem: { ...filler(60, 75), offsetMs: 10 * MINUTE_MS },
      nextItem: { type: "program", scheduleEntryId: "r0" },
    });
  });

  it("transmits filler from a reservation's last program to its explicit end", () => {
    expect(stateAt(110)).toMatchObject({
      kind: "current",
      currentItem: { ...filler(105, 120), offsetMs: 5 * MINUTE_MS },
      nextItem: { type: "program", scheduleEntryId: "p2" },
    });
  });

  it("names filler as the next item after the program before it", () => {
    expect(stateAt(45)).toMatchObject({
      kind: "current",
      currentItem: { type: "program", scheduleEntryId: "p1" },
      nextItem: filler(60, 75),
    });
  });

  it("covers a range none of whose programs fit as one interval merged with the filler before it", () => {
    const entries = [...BEFORE, AFTER];

    expect(stateAt(100, entries)).toMatchObject({
      currentItem: { ...filler(60, 120), offsetMs: 40 * MINUTE_MS },
    });
  });

  it("gives one filler the same interval from every instant across reservations it reaches", () => {
    const entries = [...BEFORE, RESERVED, entry("p2", 160, 190)];
    const reservations = [range(75, 120), range(120, 160)];

    for (const minutes of [110, 140]) {
      expect(stateAt(minutes, entries, reservations)).toMatchObject({
        currentItem: filler(105, 160),
      });
    }
  });

  it("ends filler at a later reservation's first program when the range before it fits nothing", () => {
    const entries = [...BEFORE, entry("q0", 130, 150), entry("p2", 160, 190)];
    const reservations = [range(75, 120), range(120, 160)];

    expect(stateAt(100, entries, reservations)).toMatchObject({
      currentItem: filler(60, 130),
    });
  });

  it("reports a hole between two of a reservation's programs as a schedule gap", () => {
    const entries = [
      ...BEFORE,
      entry("r0", 75, 90),
      entry("r1", 100, 110),
      AFTER,
    ];

    expect(stateAt(95, entries)).toMatchObject({
      kind: "no_current",
      reason: "schedule_gap",
    });
  });

  it("joins filler at offset zero at its start and hands over exactly at its end", () => {
    expect(stateAt(60)).toMatchObject({
      currentItem: { ...filler(60, 75), offsetMs: 0 },
    });
    expect(stateAt(75)).toMatchObject({
      currentItem: { type: "program", scheduleEntryId: "r0", offsetMs: 0 },
    });
    // The reservation's range is half-open: its end is no longer filler.
    expect(stateAt(120, [...BEFORE, RESERVED])).toMatchObject({
      kind: "no_current",
      reason: "schedule_gap",
    });
  });

  it("derives the same filler from reservations in any order, and none before the anchor", () => {
    const reservations = [range(300, 330), range(75, 120)];

    expect(stateAt(70, ENTRIES, reservations)).toMatchObject({
      currentItem: filler(60, 75),
    });
    expect(stateAt(5, [RESERVED, AFTER], RESERVATIONS, at(10))).toMatchObject({
      kind: "no_current",
      reason: "schedule_gap",
    });
  });

  it("merges filler across back-to-back reservations whose programs leave time unused", () => {
    const entries = [
      ...BEFORE,
      RESERVED,
      entry("q0", 120, 130),
      entry("p2", 160, 190),
    ];
    const reservations = [range(75, 120), range(120, 160)];

    expect(stateAt(140, entries, reservations)).toMatchObject({
      currentItem: filler(130, 160),
    });
    expect(stateAt(65, entries, reservations)).toMatchObject({
      currentItem: filler(60, 75),
    });
  });

  it("ends a reservation's unused tail at its end even before the next program exists", () => {
    expect(stateAt(110, [...BEFORE, RESERVED])).toMatchObject({
      currentItem: filler(105, 120),
      nextItem: null,
    });
  });

  it("starts filler at the schedule anchor when no program precedes it", () => {
    expect(stateAt(20, [RESERVED, AFTER], RESERVATIONS, at(10))).toMatchObject({
      currentItem: { ...filler(10, 75), offsetMs: 10 * MINUTE_MS },
    });
  });

  it("reports a gap no reservation explains as a schedule gap", () => {
    // A hole between programs that a later reservation does not reach.
    const entries = [entry("p0", 0, 30), entry("p1", 40, 70), RESERVED];

    expect(stateAt(35, entries)).toMatchObject({
      kind: "no_current",
      reason: "schedule_gap",
    });
    expect(stateAt(150, [...BEFORE, RESERVED])).toMatchObject({
      kind: "no_current",
      reason: "schedule_gap",
    });
  });

  it("walks following items from a program through filler to the reserved program and back", () => {
    const following = followingAfter(
      { kind: "program", scheduleEntryId: "p1" },
      4,
    );

    expect(following.status).toBe("selected");
    expect(shape(following.items)).toEqual([
      "filler@60-75",
      "r0@75-105",
      "filler@105-120",
      "p2@120-150",
    ]);
  });

  it("continues after a filler cursor named by its end", () => {
    const following = followingAfter({ kind: "filler", endsAt: at(75) }, 2);

    expect(shape(following.items)).toEqual(["r0@75-105", "filler@105-120"]);
  });

  it("reports a filler cursor stale when no filler ends at that instant any more", () => {
    // An edit moved the reservation to 60, so no filler ends at 75.
    const entries = [...BEFORE, entry("r0", 60, 90), AFTER];

    expect(
      selectFollowingPlayout({
        channelId: CHANNEL_ID,
        scheduleRevision: SCHEDULE_REVISION,
        cursor: { kind: "filler", endsAt: at(75) },
        entries,
        reservations: [range(60, 120)],
        anchorTime: at(0),
        count: 1,
      }),
    ).toEqual({
      channelId: CHANNEL_ID,
      scheduleRevision: SCHEDULE_REVISION,
      status: "stale_entry",
      items: [],
    });
  });

  it("lists filler beside programs in a window timeline, but no unexplained gap", () => {
    // A hole from 160 to 170 that no reservation explains.
    const items = buildPlayoutTimeline({
      channelId: CHANNEL_ID,
      scheduleRevision: SCHEDULE_REVISION,
      window: { start: at(50), end: at(175) },
      entries: [...ENTRIES, entry("p3", 170, 200)],
      reservations: RESERVATIONS,
      anchorTime: at(0),
    });

    expect(shape(items)).toEqual([
      "p1@30-60",
      "filler@60-75",
      "r0@75-105",
      "filler@105-120",
      "p2@120-150",
      "p3@170-200",
    ]);
  });
});
