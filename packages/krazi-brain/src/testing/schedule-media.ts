import type { ScheduleMedia } from "../schedule/contracts.js";

/**
 * Builds an available media item that is schedulable, with no ordering
 * facts, unless a test overrides it, so each test states only the facts it
 * is about.
 */
export function scheduleMedia(
  id: string,
  overrides: Partial<Omit<ScheduleMedia, "id">> = {},
): ScheduleMedia {
  return {
    id,
    title: `Title ${id}`,
    status: "available",
    durationMs: 60_000,
    seriesTmdbId: null,
    seriesName: null,
    seasonNumber: null,
    episodeNumber: null,
    releaseDate: null,
    ...overrides,
  };
}

/**
 * Builds `count` schedulable items of `minutes` each, named `<prefix>1`,
 * `<prefix>2`, ..., so a test can tell every source's airings apart.
 */
export function numberedMedia(
  prefix: string,
  count: number,
  minutes: number,
): ScheduleMedia[] {
  return Array.from({ length: count }, (_, index) =>
    scheduleMedia(`${prefix}${index + 1}`, { durationMs: minutes * 60_000 }),
  );
}
