import {
  createChannelStreamManager,
  createFfmpegSignalPackager,
  findMpegTsJoinPoint,
  SystemRuntime,
  type ChannelAuthorization,
  type ChannelAuthorizationResult,
  type ChannelId,
  type ChannelStreamManagerContract,
  type Clock,
  type CurrentPlayoutResult,
  type FollowingPlayoutResult,
  type PlayoutProvider,
  type SelectedPlayoutItem,
  type SignalLogger,
  type TransitionCandidate,
  type TransitionCoordinator,
} from "@krazitv/signal";

import type { SpikeConfig } from "./config.js";

const CHANNEL_ID = "69";
const SCHEDULE_REVISION = 1;

type FixedPlayoutOptions = Pick<
  SpikeConfig,
  "mediaAPath" | "mediaBPath" | "mediaDurationMs"
> & {
  /** Defaults to the media length; a longer slot airs a black tail. */
  airtimeMs?: number;
  startedAt: number;
  record?: (event: string, context: Readonly<Record<string, unknown>>) => void;
};

/** Provides the one fixed channel allowed by this disposable experiment. */
export class FixedChannelAuthorization implements ChannelAuthorization {
  /** Keeps unknown IDs out of the production channel runtime. */
  async getChannelAuthorization(
    channelId: ChannelId,
  ): Promise<ChannelAuthorizationResult> {
    return channelId === CHANNEL_ID
      ? { status: "enabled", channelId }
      : { status: "not_found", channelId };
  }
}

/** Projects the two known files onto an endless deterministic wall-clock loop. */
export class FixedSpikePlayoutProvider implements PlayoutProvider {
  /** Retains only explicit experiment inputs and its startup epoch. */
  constructor(private readonly options: FixedPlayoutOptions) {}

  /** Resolves the media position viewers should see at this instant. */
  async getCurrent(
    channelId: ChannelId,
    atMs: number,
  ): Promise<CurrentPlayoutResult> {
    if (channelId !== CHANNEL_ID) {
      return {
        status: "no_current",
        channelId,
        scheduleRevision: SCHEDULE_REVISION,
        evaluatedAt: atMs,
        reason: "schedule_gap",
      };
    }
    const ordinal = this.ordinalAt(atMs);
    const item = this.item(ordinal);
    this.options.record?.("playout_state_evaluated", {
      channelId,
      evaluatedAt: atMs,
      scheduleEntryId: item.scheduleEntryId,
      mediaItemId: item.mediaItemId,
      mediaOffsetMs: Math.max(0, atMs - item.startsAt),
    });
    return {
      status: "current",
      channelId,
      scheduleRevision: SCHEDULE_REVISION,
      evaluatedAt: atMs,
      mediaOffsetMs: Math.max(0, atMs - item.startsAt),
      item,
    };
  }

  /** Supplies exactly the contiguous successor requested by the worker. */
  async getFollowing(
    channelId: ChannelId,
    afterScheduleEntryId: string,
    count: number,
  ): Promise<FollowingPlayoutResult> {
    const ordinal = parseOrdinal(afterScheduleEntryId);
    if (channelId !== CHANNEL_ID || ordinal === undefined) {
      return {
        status: "stale_entry",
        channelId,
        scheduleRevision: SCHEDULE_REVISION,
        items: [],
      };
    }
    return {
      status: "selected",
      channelId,
      scheduleRevision: SCHEDULE_REVISION,
      items: count > 0 ? [this.item(ordinal + 1)] : [],
    };
  }

  /** Exposes the fixed revision used by transition revalidation. */
  async getScheduleRevision(_channelId: ChannelId): Promise<number> {
    return SCHEDULE_REVISION;
  }

  /** Uses integer division so boundaries always select the following item. */
  private ordinalAt(atMs: number): number {
    return Math.max(
      0,
      Math.floor((atMs - this.options.startedAt) / this.slotMs()),
    );
  }

  /** Slots default to the media length; a longer slot airs a black tail. */
  private slotMs(): number {
    return this.options.airtimeMs ?? this.options.mediaDurationMs;
  }

  /** Builds one complete atomic selection without storing mutable schedule state. */
  private item(ordinal: number): SelectedPlayoutItem {
    const isA = ordinal % 2 === 0;
    const startsAt = this.options.startedAt + ordinal * this.slotMs();
    return {
      channelId: CHANNEL_ID,
      scheduleEntryId: `spike-${ordinal}-${isA ? "a" : "b"}`,
      scheduleRevision: SCHEDULE_REVISION,
      mediaItemId: isA ? "spike-video-a" : "spike-video-b",
      mediaPath: isA ? this.options.mediaAPath : this.options.mediaBPath,
      hasAudio: true,
      hasVideo: true,
      title: isA ? "VIDEO A" : "VIDEO B",
      startsAt,
      endsAt: startsAt + this.slotMs(),
      durationMs: this.options.mediaDurationMs,
      startOffsetMs: 0,
    };
  }
}

/** Revalidates a prepared transition against the same fixed projection. */
export class FixedTransitionCoordinator implements TransitionCoordinator {
  /** Shares the provider projection rather than inventing transition policy. */
  constructor(
    private readonly provider: PlayoutProvider,
    private readonly clock: Clock,
  ) {}

  /** Commits only while the candidate still covers the current wall-clock time. */
  async commitPreparedTransition(
    candidate: TransitionCandidate,
    commit: () => void,
  ): Promise<"committed" | "stale"> {
    const current = await this.provider.getCurrent(
      candidate.channelId,
      this.clock.now(),
    );
    if (
      current.status !== "current" ||
      current.scheduleRevision !== candidate.scheduleRevision ||
      current.item.scheduleEntryId !== candidate.scheduleEntryId
    ) {
      return "stale";
    }
    commit();
    return "committed";
  }
}

/** Timestamps retained lifecycle events when they reach the disposable harness. */
const recordSpikeMeasurement = (
  event: string,
  context: Readonly<Record<string, unknown>> = {},
): void => {
  console.info(event, { recordedAtMs: Date.now(), ...context });
};

const logger: SignalLogger = {
  debug: (message, context) =>
    console.debug(message, { recordedAtMs: Date.now(), ...context }),
  info: recordSpikeMeasurement,
  warn: (message, context) =>
    console.warn(message, { recordedAtMs: Date.now(), ...context }),
  error: (message, context) =>
    console.error(message, { recordedAtMs: Date.now(), ...context }),
};

/** Composes public production constructors with only disposable outer adapters. */
export function createSpikeManager(
  config: SpikeConfig,
): ChannelStreamManagerContract {
  const runtime = new SystemRuntime();
  const provider = new FixedSpikePlayoutProvider({
    startedAt: runtime.now(),
    mediaAPath: config.mediaAPath,
    mediaBPath: config.mediaBPath,
    mediaDurationMs: config.mediaDurationMs,
    airtimeMs: config.airtimeMs,
    record: recordSpikeMeasurement,
  });
  const packager = createFfmpegSignalPackager({
    logger,
    timers: runtime,
    ffmpegPath: config.ffmpegPath,
  });
  return createChannelStreamManager({
    authorization: new FixedChannelAuthorization(),
    playoutProvider: provider,
    packager,
    clock: runtime,
    timers: runtime,
    transitionCoordinator: new FixedTransitionCoordinator(provider, runtime),
    idleGraceMs: 5_000,
    logger,
    prepareLeadMs: 2_000,
    startupTimeoutMs: 2_000,
    subscriberBufferLimitBytes: 4 * 1024 * 1024,
    retentionLimitBytes: 4 * 1024 * 1024,
    findJoinPoint: findMpegTsJoinPoint,
  });
}

/** Accepts only entry IDs created by this fixed provider. */
function parseOrdinal(scheduleEntryId: string): number | undefined {
  const match = /^spike-(\d+)-[ab]$/.exec(scheduleEntryId);
  if (match === null) return undefined;
  const ordinal = Number(match[1]);
  return Number.isSafeInteger(ordinal) ? ordinal : undefined;
}
