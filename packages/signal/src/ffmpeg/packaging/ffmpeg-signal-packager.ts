import {
  assertPositiveSafeInteger,
  type ProcessSpawner,
} from "@krazitv/process";

import {
  buildFfmpegArguments,
  buildStandInArguments,
  sessionBacklogMs,
} from "./arguments/ffmpeg-arguments.js";
import { FfmpegProcess } from "../process/ffmpeg-process.js";
import { FfmpegSignalSession } from "./session/ffmpeg-signal-session.js";
import { itemContext } from "./session/item-log-context.js";
import type { OutputReadinessInspector } from "../contracts.js";
import { MpegTsBacklogInspector } from "../mpeg-ts/mpeg-ts-backlog-inspector.js";
import { MpegTsReadinessInspector } from "../mpeg-ts/mpeg-ts-readiness-inspector.js";
import type { Clock, TimerScheduler } from "../../runtime/clock.js";
import type { SignalLogger } from "../../runtime/signal-logger.js";
import type {
  SignalPackager,
  SignalPlayoutItem,
  SignalSession,
} from "../../signal-packager/contracts.js";

type FfmpegSignalPackagerDependencies = {
  spawner: ProcessSpawner;
  /**
   * Whether a prepared program's media can be read, checked before its
   * FFmpeg process starts so a missing file prepares a stand-in instead.
   */
  isMediaPresent: (mediaPath: string) => Promise<boolean>;
  timers: TimerScheduler;
  /** Times how long a first viewer's tune is held for the burst backlog. */
  clock: Clock;
  logger: SignalLogger;
  /** Executable to spawn; the server resolves `FFMPEG_PATH` before this point. */
  ffmpegPath: string;
  terminationGraceMs?: number;
  /** How long a prepared item's FFmpeg process may stay silent before its preparation fails. */
  itemReadinessTimeoutMs?: number;
  /** How long an airing FFmpeg process may stop producing output before a stand-in replaces it. */
  outputStallTimeoutMs?: number;
  /** How much output a prepared process may hold before its commit (ADR 0016). */
  preparedOutputLimitBytes?: number;
  createReadinessInspector?: () => OutputReadinessInspector;
  /** The font filler messages are drawn in; unset uses fontconfig's default. */
  fillerFontFile?: string | undefined;
};

const DEFAULT_ITEM_READINESS_TIMEOUT_MS = 15_000;
// A healthy process writes several chunks a second. Viewers hold about ten
// seconds from their join backlog (ADR 0018), so a stand-in started after
// five seconds of silence reaches them before their picture freezes. A slow
// read that recovers is not lost: its item returns (ADR 0020).
const DEFAULT_OUTPUT_STALL_TIMEOUT_MS = 5_000;
// How long a first viewer's tune may wait for the burst backlog. Plex waited
// out 15 s tunes in testing; the server's startup timeout must exceed this.
const INITIAL_HOLD_LIMIT_MS = 10_000;
// A few seconds of 1080p MPEG-TS is a few megabytes; this bounds a
// preparation held far longer than its lead without ever cutting one short.
const DEFAULT_PREPARED_OUTPUT_LIMIT_BYTES = 64 * 1024 * 1024;

/** Creates one retained FFmpeg session per active channel worker. */
export class FfmpegSignalPackager implements SignalPackager {
  private readonly itemReadinessTimeoutMs: number;
  private readonly outputStallTimeoutMs: number;
  private readonly preparedOutputLimitBytes: number;

  /**
   * Keeps process and inspection dependencies explicit for deterministic
   * tests, and validates configuration so a bad value fails at startup.
   */
  constructor(private readonly dependencies: FfmpegSignalPackagerDependencies) {
    if (dependencies.ffmpegPath === "") {
      throw new RangeError("ffmpegPath must not be empty");
    }
    this.itemReadinessTimeoutMs =
      dependencies.itemReadinessTimeoutMs ?? DEFAULT_ITEM_READINESS_TIMEOUT_MS;
    assertPositiveSafeInteger(
      this.itemReadinessTimeoutMs,
      "itemReadinessTimeoutMs",
    );
    this.outputStallTimeoutMs =
      dependencies.outputStallTimeoutMs ?? DEFAULT_OUTPUT_STALL_TIMEOUT_MS;
    assertPositiveSafeInteger(
      this.outputStallTimeoutMs,
      "outputStallTimeoutMs",
    );
    this.preparedOutputLimitBytes =
      dependencies.preparedOutputLimitBytes ??
      DEFAULT_PREPARED_OUTPUT_LIMIT_BYTES;
    assertPositiveSafeInteger(
      this.preparedOutputLimitBytes,
      "preparedOutputLimitBytes",
    );
  }

  /**
   * Validates and starts one item synchronously so output can be drained at
   * once. Only this first process starts the session's way, with low latency
   * and the join backlog, because a tune request and its viewer wait on it;
   * the session starts prepared items normally.
   */
  start(initialItem: SignalPlayoutItem): SignalSession {
    const process = this.spawnFor(
      initialItem,
      this.argumentsFor(initialItem, true),
    );
    const createReadinessInspector =
      this.dependencies.createReadinessInspector ??
      (() => new MpegTsReadinessInspector());

    return new FfmpegSignalSession(process, initialItem, {
      initialReadinessInspector:
        this.dependencies.createReadinessInspector?.() ??
        this.initialReadinessInspector(initialItem),
      createReadinessInspector,
      startProcess: (item) =>
        this.spawnFor(item, this.argumentsFor(item, false)),
      startStandIn: (item) =>
        this.spawnFor(
          item,
          buildStandInArguments(item, {
            fontFile: this.dependencies.fillerFontFile,
          }),
        ),
      isMediaPresent: this.dependencies.isMediaPresent,
      timers: this.dependencies.timers,
      itemReadinessTimeoutMs: this.itemReadinessTimeoutMs,
      outputStallTimeoutMs: this.outputStallTimeoutMs,
      preparedOutputLimitBytes: this.preparedOutputLimitBytes,
      logger: this.dependencies.logger,
    });
  }

  /**
   * Holds the first process unready until its burst backlog is written, one
   * keyframe per second of it plus the one it starts on, so the first
   * viewer's tune answers with all of it (ADR 0018). Without a burst, the
   * first complete packets are enough.
   */
  private initialReadinessInspector(
    item: SignalPlayoutItem,
  ): OutputReadinessInspector {
    const backlogMs = sessionBacklogMs(item);
    if (backlogMs === 0) return new MpegTsReadinessInspector();
    return new MpegTsBacklogInspector(
      Math.floor(backlogMs / 1_000) + 1,
      this.dependencies.clock,
      INITIAL_HOLD_LIMIT_MS,
    );
  }

  /** Builds one item's argv with this packager's rendering options. */
  private argumentsFor(
    item: SignalPlayoutItem,
    startsSession: boolean,
  ): readonly string[] {
    return buildFfmpegArguments(item, {
      fontFile: this.dependencies.fillerFontFile,
      startsSession,
    });
  }

  /**
   * Starts one FFmpeg process for an item, whose normal exit remains internal
   * to its session. Callers build the argv first, which validates the item,
   * so an invalid one is refused before anything is spawned.
   */
  private spawnFor(
    item: SignalPlayoutItem,
    args: readonly string[],
  ): FfmpegProcess {
    const process = FfmpegProcess.start({
      args,
      spawner: this.dependencies.spawner,
      timers: this.dependencies.timers,
      logger: this.dependencies.logger,
      ffmpegPath: this.dependencies.ffmpegPath,
      terminationGraceMs: this.dependencies.terminationGraceMs,
      diagnosticContext: itemContext(item),
      // FFmpeg names its input in errors; logs must never carry the path.
      redactions: item.kind === "program" ? [item.mediaPath] : [],
    });
    this.dependencies.logger.info("ffmpeg_process_started", itemContext(item));
    return process;
  }
}
