// Factories the server composes the signal runtime from.
export { createChannelStreamManager } from "./create-channel-stream-manager.js";
export { createFfmpegSignalPackager } from "./create-ffmpeg-signal-packager.js";
export { findMpegTsJoinPoint } from "./ffmpeg/mpeg-ts/mpeg-ts-join-point.js";
export { SystemRuntime } from "./runtime/system-runtime.js";

// What callers receive from the channel stream manager.
export type {
  ChannelStopReason,
  ChannelStreamManagerContract,
  ChannelSubscribeOptions,
  ChannelSubscription,
} from "./channel-stream-manager/contracts.js";
export { SignalError, type SignalErrorCode } from "./errors.js";

// Ports the server implements so workers can authorize channels and commit transitions.
export type {
  ChannelAuthorization,
  ChannelAuthorizationResult,
  TransitionCandidate,
  TransitionCoordinator,
} from "./channel-worker/contracts.js";

// Port kraziBrain's adapter implements to tell workers what plays.
export type {
  ChannelId,
  CurrentPlayoutResult,
  FollowingPlayoutResult,
  PlayoutProvider,
  SelectedPlayoutItem,
} from "./playout/contracts.js";

// Runtime ports injected so time and logging stay deterministic in tests.
export type { Clock, ScheduledTask, TimerScheduler } from "./runtime/clock.js";
export type { SignalLogger } from "./runtime/signal-logger.js";

// The packaging port a SignalPackager implementation fulfils.
export type {
  SignalPackager,
  SignalPlayoutItem,
  SignalPreparation,
  SignalSession,
} from "./signal-packager/contracts.js";
