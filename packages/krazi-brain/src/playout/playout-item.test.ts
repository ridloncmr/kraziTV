import { describe, expect, it } from "vitest";

import {
  HALF_HOUR_MS,
  halfHourPlayoutEntry,
} from "../testing/playout-entries.js";
import type { PlayoutEntry } from "./contracts.js";
import { buildPlayoutTimeline } from "./playout-item.js";

const CHANNEL_ID = "channel_69";
const SCHEDULE_REVISION = 12;

// The example channel's timeline inputs over exactly its entries' span,
// with no reservation, so every item is a program.
function programsOnly(entries: readonly PlayoutEntry[]) {
  return {
    channelId: CHANNEL_ID,
    scheduleRevision: SCHEDULE_REVISION,
    reservations: [],
    anchorTime: 0,
    window: {
      start: entries[0]?.startsAt ?? 0,
      end: entries.at(-1)?.endsAt ?? 0,
    },
    entries,
  };
}

// Builds the example channel's timeline from the given entries.
function timeline(entries: readonly PlayoutEntry[]): string[] {
  return buildPlayoutTimeline(programsOnly(entries)).map((item) =>
    item.type === "program" ? item.scheduleEntryId : "filler",
  );
}

// The one program item a timeline of one entry holds.
function onlyProgram(entry: PlayoutEntry) {
  const [item] = buildPlayoutTimeline(programsOnly([entry]));
  if (item?.type !== "program") throw new Error("expected a program");
  return item;
}

describe("buildPlayoutTimeline", () => {
  it("maps each playable entry to a playout item carrying the revision", () => {
    const entry = halfHourPlayoutEntry("entry_1", 0);

    expect(buildPlayoutTimeline(programsOnly([entry]))).toEqual([
      {
        type: "program",
        channelId: CHANNEL_ID,
        scheduleRevision: SCHEDULE_REVISION,
        scheduleEntryId: "entry_1",
        mediaItemId: entry.mediaItemId,
        mediaPath: entry.media.path,
        hasAudio: true,
        hasVideo: true,
        title: entry.title,
        startsAt: entry.startsAt,
        endsAt: entry.endsAt,
        durationMs: HALF_HOUR_MS,
        startOffsetMs: 0,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      },
    ]);
  });

  it("carries a missing video stream so packaging can render black", () => {
    const item = onlyProgram(
      halfHourPlayoutEntry("entry_1", 0, { hasVideo: false }),
    );

    expect(item.hasVideo).toBe(false);
  });

  // Video detection arrived after the first catalogs; until a rescan records
  // the fact, an item keeps the video it was always packaged with.
  it("assumes video for media cataloged before video detection", () => {
    const item = onlyProgram(
      halfHourPlayoutEntry("entry_1", 0, { hasVideo: null }),
    );

    expect(item.hasVideo).toBe(true);
  });

  it("omits unplayable entries and keeps the rest in order", () => {
    const entries = [
      halfHourPlayoutEntry("entry_1", 0),
      halfHourPlayoutEntry("entry_missing", 1, { status: "missing" }),
      halfHourPlayoutEntry("entry_3", 2),
      halfHourPlayoutEntry("entry_no_audio_fact", 3, { hasAudio: null }),
      halfHourPlayoutEntry("entry_5", 4),
    ];

    expect(timeline(entries)).toEqual(["entry_1", "entry_3", "entry_5"]);
  });

  it("keeps entries separated by a gap, unlike following selection", () => {
    expect(
      timeline([
        halfHourPlayoutEntry("entry_1", 0),
        halfHourPlayoutEntry("entry_4", 3),
      ]),
    ).toEqual(["entry_1", "entry_4"]);
  });

  it("returns an empty timeline for no entries", () => {
    expect(timeline([])).toEqual([]);
  });
});
