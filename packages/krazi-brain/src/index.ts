/**
 * kraziBrain: decides what plays, when it plays, and why. Provider-neutral
 * scheduling and playout decisions live here; FFmpeg, HTTP, SQLite, and
 * provider formatting do not.
 */

// Current channel state, following items, and window timelines the server
// derives from one schedule snapshot.
export { deriveChannelState } from "./playout/channel-state.js";
export { selectFollowingPlayout } from "./playout/following-playout.js";
export { buildPlayoutTimeline } from "./playout/playout-item.js";
export type {
  ChannelState,
  FollowingPlayout,
  PlayoutEntry,
  PlayoutMedia,
} from "./playout/contracts.js";

// Schedule generation the server materializes into persisted entries.
export { generateScheduleEntries } from "./schedule/generate-schedule-entries.js";
export {
  findRegenerationBoundary,
  restorePlaybackProgress,
} from "./schedule/regeneration.js";
export { SCHEDULE_HORIZON_MS } from "./schedule/schedule-policy.js";
export { deriveChannelSeed } from "./schedule/seeded-hash.js";
export { PLAYBACK_MODES } from "./schedule/contracts.js";
export type {
  GeneratedScheduleEntry,
  PlaybackMode,
  PlaybackProgress,
  RestorableEntry,
  ScheduleMedia,
  ScheduleSource,
} from "./schedule/contracts.js";
