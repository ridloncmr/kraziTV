import {
  assertPositiveSafeInteger,
  type ProcessSpawner,
} from "@krazitv/process";

import { buildFfmpegArguments } from "./ffmpeg-arguments.js";
import { FfmpegProcess } from "../process/ffmpeg-process.js";
import { FfmpegSignalSession } from "./ffmpeg-signal-session.js";
import { itemContext } from "./item-log-context.js";
import type { OutputReadinessInspector } from "../contracts.js";
import { MpegTsReadinessInspector } from "../mpeg-ts/mpeg-ts-readiness-inspector.js";
import type { TimerScheduler } from "../../runtime/clock.js";
import type { SignalLogger } from "../../runtime/signal-logger.js";
import type {
  SignalPackager,
  SignalPlayoutItem,
  SignalSession,
} from "../../signal-packager/contracts.js";

type FfmpegSignalPackagerDependencies = {
  spawner: ProcessSpawner;
  timers: TimerScheduler;
  logger: SignalLogger;
  /** Executable to spawn; the server resolves `FFMPEG_PATH` before this point. */
  ffmpegPath: string;
  terminationGraceMs?: number;
  /** How long a prepared item's FFmpeg process may stay silent before its preparation fails. */
  itemReadinessTimeoutMs?: number;
  /** How much output a prepared process may hold before its commit (ADR 0016). */
  preparedOutputLimitBytes?: number;
  createReadinessInspector?: () => OutputReadinessInspector;
  /** The font filler messages are drawn in; unset uses fontconfig's default. */
  fillerFontFile?: string | undefined;
};

const DEFAULT_ITEM_READINESS_TIMEOUT_MS = 15_000;
// A few seconds of 1080p MPEG-TS is a few megabytes; this bounds a
// preparation held far longer than its lead without ever cutting one short.
const DEFAULT_PREPARED_OUTPUT_LIMIT_BYTES = 64 * 1024 * 1024;

/** Creates one retained FFmpeg session per active channel worker. */
export class FfmpegSignalPackager implements SignalPackager {
  private readonly itemReadinessTimeoutMs: number;
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
    this.preparedOutputLimitBytes =
      dependencies.preparedOutputLimitBytes ??
      DEFAULT_PREPARED_OUTPUT_LIMIT_BYTES;
    assertPositiveSafeInteger(
      this.preparedOutputLimitBytes,
      "preparedOutputLimitBytes",
    );
  }

  /** Validates and starts one item synchronously so output can be drained at once. */
  start(initialItem: SignalPlayoutItem): SignalSession {
    const process = this.startProcess(initialItem);

    return new FfmpegSignalSession(process, initialItem, {
      createReadinessInspector:
        this.dependencies.createReadinessInspector ??
        (() => new MpegTsReadinessInspector()),
      startProcess: (item) => this.startProcess(item),
      timers: this.dependencies.timers,
      itemReadinessTimeoutMs: this.itemReadinessTimeoutMs,
      preparedOutputLimitBytes: this.preparedOutputLimitBytes,
      logger: this.dependencies.logger,
    });
  }

  /** Builds one item's argv with this packager's rendering options. */
  private argumentsFor(item: SignalPlayoutItem): readonly string[] {
    return buildFfmpegArguments(item, {
      fontFile: this.dependencies.fillerFontFile,
    });
  }

  /**
   * Starts one item's FFmpeg process, whose normal exit remains internal to
   * its session. Building the argv validates the item first, so an invalid
   * one is refused before anything is spawned.
   */
  private startProcess(item: SignalPlayoutItem): FfmpegProcess {
    const process = FfmpegProcess.start({
      args: this.argumentsFor(item),
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
