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
      ...media,
    },
  };
}
