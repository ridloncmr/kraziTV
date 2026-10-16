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
export { canProgramByDefault } from "./krazi-plan/rotation/rotation.js";
export { findStretchProblem } from "./krazi-plan/stretches/stretch-settings.js";
export { findRuleSourceProblem } from "./krazi-plan/rules/rule-settings.js";
export {
  ASSIGNMENT_PARTICIPATIONS,
  RULE_BEHAVIORS,
} from "./krazi-plan/contracts.js";
export type {
  AssignmentMember,
  AssignmentParticipation,
  AssignmentSkip,
  BlockSource,
  GeneratedBlock,
  LatestTurn,
  MarathonSettings,
  ProgrammingAssignment,
  ProgrammingRule,
  ProgrammingUnschedulableReason,
  RuleMarathon,
  RuleSource,
  SettingOrigins,
  RotationCheckpoint,
  StretchSetting,
} from "./krazi-plan/contracts.js";

// Calendar conditions programming rules are evaluated by, in the
// server-wide programming timezone.
export { findCalendarProblem } from "./calendar/calendar-problems.js";
export type { CalendarConditions } from "./calendar/contracts.js";

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
