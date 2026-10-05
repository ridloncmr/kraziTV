import type {
  ChannelAuthorization,
  ChannelSubscription,
  Clock,
  PlayoutProvider,
  SignalLogger,
  TimerScheduler,
  TransitionCoordinator,
} from "../index.js";
import {
  createChannelStreamManager,
  createFfmpegSignalPackager,
} from "../index.js";

// These fixtures import only the public entry point, proving server adapters do
// not need signal internals.
const authorizationAdapter = {
  async getChannelAuthorization(channelId: string) {
    return { status: "enabled" as const, channelId };
  },
} satisfies ChannelAuthorization;

const playoutAdapter = {
  async getCurrent() {
    return {
      status: "no_current" as const,
      channelId: "fixture",
      scheduleRevision: 1,
      evaluatedAt: 0,
      reason: "schedule_gap" as const,
    };
  },
  async getFollowing() {
    return {
      status: "selected" as const,
      channelId: "fixture",
      scheduleRevision: 1,
      items: [],
    };
  },
} satisfies PlayoutProvider;

const transitionAdapter = {
  async commitPreparedTransition(
    _candidate: Parameters<
      TransitionCoordinator["commitPreparedTransition"]
    >[0],
    commit: () => void,
  ) {
    commit();
    return "committed" as const;
  },
} satisfies TransitionCoordinator;

const clockAdapter = { now: () => Date.now() } satisfies Clock;
const timerAdapter = {
  setTimeout(callback: () => void, delayMs: number) {
    const handle = globalThis.setTimeout(callback, delayMs);
    let active = true;
    return {
      get active() {
        return active;
      },
      cancel() {
        globalThis.clearTimeout(handle);
        active = false;
      },
    };
  },
} satisfies TimerScheduler;

const loggerAdapter = {
  debug() {},
  info() {},
  warn() {},
  error() {},
} satisfies SignalLogger;

const packager = createFfmpegSignalPackager({
  logger: loggerAdapter,
  timers: timerAdapter,
  ffmpegPath: "ffmpeg",
});

const manager = createChannelStreamManager({
  authorization: authorizationAdapter,
  playoutProvider: playoutAdapter,
  packager,
  clock: clockAdapter,
  timers: timerAdapter,
  transitionCoordinator: transitionAdapter,
  prepareLeadMs: 10_000,
  startupTimeoutMs: 5_000,
  idleGraceMs: 30_000,
  logger: loggerAdapter,
  subscriberBufferLimitBytes: 1_024,
  retentionLimitBytes: 1_024,
});
const subscribe: (channelId: string) => Promise<ChannelSubscription> =
  manager.subscribe.bind(manager);
const stopChannel: (
  channelId: string,
  reason: "disabled" | "deleted",
) => Promise<void> = manager.stopChannel.bind(manager);

void [
  authorizationAdapter,
  playoutAdapter,
  transitionAdapter,
  clockAdapter,
  timerAdapter,
  loggerAdapter,
  packager,
  manager,
  subscribe,
  stopChannel,
];
