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
// not need signal internals. Each stub method exists only to satisfy its port's
// type, so its comment states which port shape it proves.
const authorizationAdapter = {
  /** Proves an authorization result is expressible from public types. */
  async getChannelAuthorization(channelId: string) {
    return { status: "enabled" as const, channelId };
  },
} satisfies ChannelAuthorization;

const playoutAdapter = {
  /** Proves the no-current playout result is public. */
  async getCurrent() {
    return {
      status: "no_current" as const,
      channelId: "fixture",
      scheduleRevision: 1,
      evaluatedAt: 0,
      reason: "schedule_gap" as const,
    };
  },
  /** Proves the selected following-playout result is public. */
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
  /** Proves a coordinator can commit using only the public candidate type. */
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
  /** Proves a native-timer scheduler fits the public ScheduledTask shape. */
  setTimeout(callback: () => void, delayMs: number) {
    const handle = globalThis.setTimeout(callback, delayMs);
    let active = true;
    return {
      /** Reports whether the native timer can still fire. */
      get active() {
        return active;
      },
      /** Clears the native timer so it can never fire. */
      cancel() {
        globalThis.clearTimeout(handle);
        active = false;
      },
    };
  },
} satisfies TimerScheduler;

// Every level is a no-op: the fixture proves only the logger's shape.
const loggerAdapter = {
  /** Satisfies SignalLogger's debug level. */
  debug() {},
  /** Satisfies SignalLogger's info level. */
  info() {},
  /** Satisfies SignalLogger's warn level. */
  warn() {},
  /** Satisfies SignalLogger's error level. */
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
  reason: "disabled" | "deleted" | "interrupted",
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
