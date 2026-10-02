/**
 * kraziBrain: decides what plays, when it plays, and why. Provider-neutral
 * scheduling and playout decisions live here; FFmpeg, HTTP, SQLite, and
 * provider formatting do not.
 */

// Schedule generation the server materializes into persisted entries.
export { generateScheduleEntries } from "./schedule/generate-schedule-entries.js";
export {
  findRegenerationBoundary,
  restorePlaybackProgress,
} from "./schedule/regeneration.js";
export { SCHEDULE_HORIZON_MS } from "./schedule/schedule-policy.js";
export { deriveChannelSeed } from "./schedule/seeded-hash.js";
export type {
  GeneratedScheduleEntry,
  PlaybackProgress,
  RestorableEntry,
  ScheduleMedia,
  ScheduleSource,
} from "./schedule/contracts.js";
