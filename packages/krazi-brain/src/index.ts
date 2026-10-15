/**
 * kraziBrain: decides what plays, when it plays, and why. Provider-neutral
 * scheduling and playout decisions live here; FFmpeg, HTTP, SQLite, and
 * provider formatting do not.
 */

// Current channel state, following items, and window timelines the server
// derives from one schedule snapshot.
export { deriveChannelState } from "./playout/channel-state.js";
export {
  assertFollowingCount,
  selectFollowingPlayout,
} from "./playout/following-playout.js";
export { buildPlayoutTimeline } from "./playout/playout-item.js";
export type {
  ChannelState,
  FollowingPlayout,
  PlayoutEntry,
  PlayoutItem,
} from "./playout/contracts.js";

// kraziPlan: continuous programming from a channel's source assignments,
// generated turn by turn into blocks and the entries they air.
export { generateProgramming } from "./krazi-plan/generate-programming.js";
export { isUsableAssignment } from "./krazi-plan/rotation.js";
export { findStretchProblem } from "./krazi-plan/stretch-settings.js";
export type {
  AssignmentMember,
  BlockSource,
  GeneratedBlock,
  LatestTurn,
  ProgrammingAssignment,
  ProgrammingUnschedulableReason,
  RotationCheckpoint,
  StretchSetting,
} from "./krazi-plan/contracts.js";

// Schedule generation the server materializes into persisted entries.
export {
  describeOrderedView,
  orderFingerprint,
} from "./schedule/ordered-view.js";
export {
  findRegenerationBoundary,
  restorePlaybackProgress,
} from "./schedule/regeneration.js";
export {
  SCHEDULE_HORIZON_MS,
  isSchedulableMedia,
} from "./schedule/schedule-policy.js";
export {
  deriveChannelSeed,
  deriveProgrammingSeed,
} from "./schedule/seeded-hash.js";
export {
  METADATA_PLAYBACK_MODES,
  NO_PROGRESS,
  PLAYBACK_MODES,
} from "./schedule/contracts.js";
export type {
  CollectionProgress,
  GeneratedScheduleEntry,
  OrderedMember,
  PlaybackMode,
  PlaybackProgress,
  ProgressReset,
  RestorableEntry,
  ScheduleMedia,
} from "./schedule/contracts.js";
