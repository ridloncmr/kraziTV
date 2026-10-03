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
  ffmpegPath?: string;
  terminationGraceMs?: number;
  itemReadinessTimeoutMs?: number;
  createReadinessInspector?: () => OutputReadinessInspector;
};

const DEFAULT_ITEM_READINESS_TIMEOUT_MS = 15_000;

/** Creates one retained FFmpeg session per active channel worker. */
export class FfmpegSignalPackager implements SignalPackager {
  private readonly itemReadinessTimeoutMs: number;

  /** Keeps process and inspection dependencies explicit for deterministic tests. */
  constructor(private readonly dependencies: FfmpegSignalPackagerDependencies) {
    this.itemReadinessTimeoutMs =
      dependencies.itemReadinessTimeoutMs ?? DEFAULT_ITEM_READINESS_TIMEOUT_MS;
    assertPositiveSafeInteger(
      this.itemReadinessTimeoutMs,
      "itemReadinessTimeoutMs",
    );
  }

  /** Validates and starts one item synchronously so output can be drained at once. */
  start(initialItem: SignalPlayoutItem): SignalSession {
    const process = this.startProcess(initialItem);

    return new FfmpegSignalSession(
      process,
      initialItem,
      this.dependencies.createReadinessInspector ??
        (() => new MpegTsReadinessInspector()),
      (item) => {
        buildFfmpegArguments(item);
      },
      (item) => this.startProcess(item),
      this.dependencies.timers,
      this.itemReadinessTimeoutMs,
      this.dependencies.logger,
    );
  }

  /** Starts one item's FFmpeg process, whose normal exit remains internal to its session. */
  private startProcess(item: SignalPlayoutItem): FfmpegProcess {
    const process = FfmpegProcess.start({
      args: buildFfmpegArguments(item),
      spawner: this.dependencies.spawner,
      timers: this.dependencies.timers,
      logger: this.dependencies.logger,
      ffmpegPath: this.dependencies.ffmpegPath,
      terminationGraceMs: this.dependencies.terminationGraceMs,
      diagnosticContext: itemContext(item),
      isSuccessfulExitExpected: () => true,
    });
    this.dependencies.logger.info("ffmpeg_process_started", itemContext(item));
    return process;
  }
}
