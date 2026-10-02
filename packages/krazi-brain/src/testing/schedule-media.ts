import type { ScheduleMedia } from "../schedule/contracts.js";

/**
 * Builds an available media item that is schedulable unless a test
 * overrides it, so each test states only the facts it is about.
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
    ...overrides,
  };
}
