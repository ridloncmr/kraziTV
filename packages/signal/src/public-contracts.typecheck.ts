import type {
  ChannelAuthorization,
  Clock,
  PlayoutProvider,
  SignalLogger,
  TimerScheduler,
  TransitionCoordinator,
} from "./index.js";

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
  async getScheduleRevision() {
    return 1;
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

void [
  authorizationAdapter,
  playoutAdapter,
  transitionAdapter,
  clockAdapter,
  timerAdapter,
  loggerAdapter,
];
