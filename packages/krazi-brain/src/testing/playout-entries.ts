import type { PlayoutEntry, PlayoutMedia } from "../playout/contracts.js";

// 2026-01-01T00:00:00.000Z as a UTC millisecond default start.
const DEFAULT_STARTS_AT = 1_767_225_600_000;
const DEFAULT_DURATION_MS = 30 * 60 * 1000;

type PlayoutEntryOverrides = Partial<Omit<PlayoutEntry, "id" | "media">> & {
  media?: Partial<PlayoutMedia>;
};

/**
 * Builds a schedule entry whose media is playable and fills its airtime
 * unless a test overrides it, so each test states only the facts it is about.
 */
export function playoutEntry(
  id: string,
  overrides: PlayoutEntryOverrides = {},
): PlayoutEntry {
  const { media, ...entry } = overrides;
  return {
    id,
    mediaItemId: `media-${id}`,
    title: `Title ${id}`,
    startsAt: DEFAULT_STARTS_AT,
    endsAt: DEFAULT_STARTS_AT + DEFAULT_DURATION_MS,
    createdAt: DEFAULT_STARTS_AT,
    updatedAt: DEFAULT_STARTS_AT,
    ...entry,
    media: {
      path: `/media/${id}.mkv`,
      status: "available",
      durationMs: DEFAULT_DURATION_MS,
      hasAudio: true,
      hasVideo: true,
      ...media,
    },
  };
}

export const HALF_HOUR_MS = 30 * 60 * 1000;

// 2026-09-28T20:00:00.000Z, where back-to-back half-hour entries begin.
const HALF_HOURS_START_AT = Date.parse("2026-09-28T20:00:00.000Z");

/**
 * Builds the entry airing in the `index`th back-to-back half hour, with media
 * filling it unless overridden, so contiguity tests state positions, not times.
 */
export function halfHourPlayoutEntry(
  id: string,
  index: number,
  media: Partial<PlayoutMedia> = {},
): PlayoutEntry {
  const startsAt = HALF_HOURS_START_AT + index * HALF_HOUR_MS;
  return playoutEntry(id, {
    startsAt,
    endsAt: startsAt + HALF_HOUR_MS,
    media: { durationMs: HALF_HOUR_MS, ...media },
  });
}
