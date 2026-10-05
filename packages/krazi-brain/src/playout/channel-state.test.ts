import { describe, expect, it } from "vitest";

import { playoutEntry } from "../testing/playout-entries.js";
import { deriveChannelState } from "./channel-state.js";
import type { ChannelState, PlayoutEntry } from "./contracts.js";

const MINUTE_MS = 60 * 1000;
const CHANNEL_ID = "channel_69";
const SCHEDULE_REVISION = 12;

// The spec 0005 example: Show A - Episode 2 airs 20:22:00 to 20:44:00.
const EPISODE_STARTS_AT = Date.parse("2026-09-28T20:22:00.000Z");
const EPISODE_ENDS_AT = Date.parse("2026-09-28T20:44:00.000Z");
const TUNED_AT = Date.parse("2026-09-28T20:31:15.000Z");
const CREATED_AT = Date.parse("2026-09-28T12:00:00.000Z");

const episode = playoutEntry("entry_456", {
  mediaItemId: "media_123",
  title: "Show A - Episode 2",
  startsAt: EPISODE_STARTS_AT,
  endsAt: EPISODE_ENDS_AT,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  media: { path: "/media/show-a/s01e02.mkv", durationMs: 22 * MINUTE_MS },
});

// An entry airing directly after the episode, with media filling its airtime.
const successor = playoutEntry("entry_457", {
  startsAt: EPISODE_ENDS_AT,
  endsAt: EPISODE_ENDS_AT + 30 * MINUTE_MS,
  media: { durationMs: 30 * MINUTE_MS },
});

// Derives the example channel's state from the given entries at one instant.
function stateAt(
  evaluatedAt: number,
  entries: readonly PlayoutEntry[],
): ChannelState {
  return deriveChannelState({
    channelId: CHANNEL_ID,
    scheduleRevision: SCHEDULE_REVISION,
    evaluatedAt,
    entries,
  });
}

describe("deriveChannelState", () => {
  it("matches the golden spec example for identical inputs every time", () => {
    const golden: ChannelState = {
      kind: "current",
      channelId: CHANNEL_ID,
      scheduleRevision: SCHEDULE_REVISION,
      evaluatedAt: TUNED_AT,
      currentItem: {
        type: "program",
        channelId: CHANNEL_ID,
        scheduleRevision: SCHEDULE_REVISION,
        scheduleEntryId: "entry_456",
        mediaItemId: "media_123",
        mediaPath: "/media/show-a/s01e02.mkv",
        hasAudio: true,
        hasVideo: true,
        title: "Show A - Episode 2",
        startsAt: EPISODE_STARTS_AT,
        endsAt: EPISODE_ENDS_AT,
        durationMs: 1_320_000,
        startOffsetMs: 0,
        offsetMs: 555_000,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
      nextItem: {
        type: "program",
        channelId: CHANNEL_ID,
        scheduleRevision: SCHEDULE_REVISION,
        scheduleEntryId: "entry_457",
        mediaItemId: successor.mediaItemId,
        mediaPath: successor.media.path,
        hasAudio: true,
        hasVideo: true,
        title: successor.title,
        startsAt: EPISODE_ENDS_AT,
        endsAt: EPISODE_ENDS_AT + 30 * MINUTE_MS,
        durationMs: 30 * MINUTE_MS,
        startOffsetMs: 0,
        createdAt: successor.createdAt,
        updatedAt: successor.updatedAt,
      },
    };

    expect(stateAt(TUNED_AT, [episode, successor])).toEqual(golden);
    expect(stateAt(TUNED_AT, [episode, successor])).toEqual(golden);
  });

  it("joins at offset zero exactly at the entry's start", () => {
    const state = stateAt(EPISODE_STARTS_AT, [episode, successor]);

    expect(state.currentItem?.scheduleEntryId).toBe("entry_456");
    expect(state.currentItem?.offsetMs).toBe(0);
  });

  it("makes the successor current exactly at the entry's end", () => {
    const state = stateAt(EPISODE_ENDS_AT, [episode, successor]);

    expect(state.currentItem?.scheduleEntryId).toBe("entry_457");
    expect(state.currentItem?.offsetMs).toBe(0);
  });

  it("picks the covering entry from any ordered input", () => {
    const earlier = playoutEntry("entry_455", {
      startsAt: EPISODE_STARTS_AT - 22 * MINUTE_MS,
      endsAt: EPISODE_STARTS_AT,
    });

    const state = stateAt(TUNED_AT, [earlier, episode, successor]);

    expect(state.currentItem?.scheduleEntryId).toBe("entry_456");
    expect(state.nextItem?.scheduleEntryId).toBe("entry_457");
  });

  describe("media shorter than its airtime", () => {
    const shortened = playoutEntry("entry_456", {
      startsAt: EPISODE_STARTS_AT,
      endsAt: EPISODE_ENDS_AT,
      media: { durationMs: 10 * MINUTE_MS },
    });

    it("stays current one millisecond before the media runs out", () => {
      const state = stateAt(EPISODE_STARTS_AT + 10 * MINUTE_MS - 1, [
        shortened,
      ]);

      expect(state.kind).toBe("current");
      expect(state.currentItem?.offsetMs).toBe(10 * MINUTE_MS - 1);
    });

    it.each([
      ["when the media runs out", 10 * MINUTE_MS],
      ["after the media runs out", 15 * MINUTE_MS],
    ])("is media_unavailable %s", (_case, offsetMs) => {
      const state = stateAt(EPISODE_STARTS_AT + offsetMs, [
        shortened,
        successor,
      ]);

      expect(state).toEqual({
        kind: "no_current",
        channelId: CHANNEL_ID,
        scheduleRevision: SCHEDULE_REVISION,
        evaluatedAt: EPISODE_STARTS_AT + offsetMs,
        currentItem: null,
        nextItem: null,
        reason: "media_unavailable",
        scheduleEntryId: "entry_456",
      });
    });
  });

  it("plays media longer than its airtime from the computed offset", () => {
    const lengthened = playoutEntry("entry_456", {
      startsAt: EPISODE_STARTS_AT,
      endsAt: EPISODE_ENDS_AT,
      media: { durationMs: 60 * MINUTE_MS },
    });

    const state = stateAt(TUNED_AT, [lengthened]);

    expect(state.currentItem?.offsetMs).toBe(555_000);
    expect(state.currentItem?.durationMs).toBe(60 * MINUTE_MS);
  });

  it.each([
    ["no entries", TUNED_AT, []],
    ["only a later entry", EPISODE_STARTS_AT - 1, [episode]],
    ["only an earlier entry", EPISODE_ENDS_AT, [episode]],
    [
      "a gap between entries",
      EPISODE_ENDS_AT + 1,
      [
        episode,
        playoutEntry("entry_457", {
          startsAt: EPISODE_ENDS_AT + 5 * MINUTE_MS,
          endsAt: EPISODE_ENDS_AT + 30 * MINUTE_MS,
        }),
      ],
    ],
  ])("is a schedule_gap with %s", (_case, evaluatedAt, entries) => {
    expect(stateAt(evaluatedAt, entries)).toEqual({
      kind: "no_current",
      channelId: CHANNEL_ID,
      scheduleRevision: SCHEDULE_REVISION,
      evaluatedAt,
      currentItem: null,
      nextItem: null,
      reason: "schedule_gap",
    });
  });

  it.each([
    ["missing media", { status: "missing" as const }],
    ["media that failed its probe", { status: "probe_failed" as const }],
    ["media with no duration", { durationMs: null }],
    ["media with a zero duration", { durationMs: 0 }],
    ["media with no audio fact", { hasAudio: null }],
  ])("is media_unavailable for %s", (_case, media) => {
    const unplayable = playoutEntry("entry_456", {
      startsAt: EPISODE_STARTS_AT,
      endsAt: EPISODE_ENDS_AT,
      media,
    });

    const state = stateAt(TUNED_AT, [unplayable, successor]);

    expect(state).toMatchObject({
      kind: "no_current",
      currentItem: null,
      nextItem: null,
      reason: "media_unavailable",
      scheduleEntryId: "entry_456",
    });
  });

  it("carries a known absence of audio as playable", () => {
    const silent = playoutEntry("entry_456", {
      startsAt: EPISODE_STARTS_AT,
      endsAt: EPISODE_ENDS_AT,
      media: { hasAudio: false },
    });

    expect(stateAt(TUNED_AT, [silent]).currentItem?.hasAudio).toBe(false);
  });

  describe("next item", () => {
    it.each([
      ["no successor exists yet", []],
      [
        "the successor starts after the current entry ends",
        [
          playoutEntry("entry_457", {
            startsAt: EPISODE_ENDS_AT + 1,
            endsAt: EPISODE_ENDS_AT + 30 * MINUTE_MS,
          }),
        ],
      ],
      [
        "the successor's media is unplayable",
        [
          playoutEntry("entry_457", {
            startsAt: EPISODE_ENDS_AT,
            endsAt: EPISODE_ENDS_AT + 30 * MINUTE_MS,
            media: { status: "missing" },
          }),
        ],
      ],
    ])("is null when %s", (_case, following) => {
      const state = stateAt(TUNED_AT, [episode, ...following]);

      expect(state.kind).toBe("current");
      expect(state.nextItem).toBeNull();
    });
  });
});
