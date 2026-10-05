import { PassThrough, type Readable } from "node:stream";

import { packagingStoppedError } from "../../errors.js";
import type {
  SignalPlayoutItem,
  SignalPreparation,
  SignalSession,
} from "../../signal-packager/contracts.js";
import type { ScheduledTask, TimerScheduler } from "../../runtime/clock.js";
import { RetryableAttempt } from "../../runtime/retryable-attempt.js";
import type { LogContext, SignalLogger } from "../../runtime/signal-logger.js";
import { MpegTsPacketForwarder } from "../mpeg-ts/mpeg-ts-packet-forwarder.js";
import type { OutputReadinessInspector } from "../contracts.js";
import type { FfmpegProcess } from "../process/ffmpeg-process.js";
import {
  FfmpegSignalPreparation,
  type PreparationOwner,
} from "./ffmpeg-signal-preparation.js";
import { itemContext } from "./item-log-context.js";
import { itemReadinessTimeout, prematureExit } from "./packaging-errors.js";

type ProcessBinding = {
  process: FfmpegProcess;
  forwarder: MpegTsPacketForwarder;
  context: LogContext;
  cancelReadiness(): void;
};

/** What a session needs from its packager to start and judge each item's FFmpeg process. */
type FfmpegSignalSessionOptions = {
  createReadinessInspector: () => OutputReadinessInspector;
  /** Rejects an item before it is held as a preparation; never starts a process. */
  validateItem: (item: SignalPlayoutItem) => void;
  startProcess: (item: SignalPlayoutItem) => FfmpegProcess;
  timers: TimerScheduler;
  itemReadinessTimeoutMs: number;
  logger: SignalLogger;
};

/** Owns one stable output while sequential FFmpeg processes serve its items. */
export class FfmpegSignalSession implements SignalSession, PreparationOwner {
  readonly output: Readable;
  readonly ready: Promise<void>;
  readonly completion: Promise<void>;
  private readonly sessionOutput = new PassThrough();
  private readonly bindings = new Map<FfmpegProcess, ProcessBinding>();
  private readonly resolveReady: () => void;
  private readonly rejectReady: (reason: unknown) => void;
  private readonly resolveCompletion: () => void;
  private readonly rejectCompletion: (reason: unknown) => void;
  private readySettled = false;
  private completionSettled = false;
  private stopping = false;
  private stopped = false;
  private readonly stopAttempt = new RetryableAttempt();
  private active: ProcessBinding;
  private preparation: FfmpegSignalPreparation | undefined;

  /** Attaches the initial FFmpeg process before exposing the session-owned stream. */
  constructor(
    process: FfmpegProcess,
    initialItem: SignalPlayoutItem,
    private readonly options: FfmpegSignalSessionOptions,
  ) {
    this.output = this.sessionOutput;
    const ready = Promise.withResolvers<void>();
    this.ready = ready.promise;
    this.resolveReady = ready.resolve;
    this.rejectReady = ready.reject;
    const completion = Promise.withResolvers<void>();
    this.completion = completion.promise;
    this.resolveCompletion = completion.resolve;
    this.rejectCompletion = completion.reject;
    void this.ready.catch(() => undefined);
    void this.completion.catch(() => undefined);
    this.active = this.attach(process, initialItem, "initial");
  }

  /** Validates one bounded future item without starting or buffering output. */
  async prepare(item: SignalPlayoutItem): Promise<SignalPreparation> {
    this.assertRunning();
    if (this.preparation !== undefined) {
      throw new Error("Session already has an outstanding preparation");
    }
    this.options.validateItem(item);
    this.assertRunning();
    const preparation = new FfmpegSignalPreparation(this, item);
    this.preparation = preparation;
    return preparation;
  }

  /** Stops every FFmpeg process and ends the stable output only after verified closure. */
  stop(): Promise<void> {
    return this.stopAttempt.run(() => {
      this.stopping = true;
      this.settleReadyWithError(packagingStoppedError());
      if (this.preparation !== undefined) {
        void this.preparation.discard();
      }
      for (const binding of this.bindings.values()) {
        binding.cancelReadiness();
      }
      return this.stopAllProcesses();
    });
  }

  /** Atomically replaces the FFmpeg process feeding the stable output. */
  commitPreparation(preparation: FfmpegSignalPreparation): void {
    this.assertRunning();
    this.assertCurrentPreparation(preparation);

    const previous = this.active;
    previous.forwarder.detach();
    this.preparation = undefined;

    let next: FfmpegProcess;
    try {
      next = this.options.startProcess(preparation.item);
    } catch (error) {
      void previous.process.stop().catch(() => undefined);
      this.fail(error);
      throw error;
    }

    this.active = this.attach(next, preparation.item, "committed");
    this.options.logger.info(
      "signal_transition_committed",
      this.active.context,
    );
    void previous.process.stop().catch((error: unknown) => this.fail(error));
  }

  /** Releases only the currently owned preparation. */
  discardPreparation(preparation: FfmpegSignalPreparation): void {
    this.assertCurrentPreparation(preparation);
    this.preparation = undefined;
  }

  /** Attaches packet forwarding and observes one FFmpeg process as session-internal. */
  private attach(
    process: FfmpegProcess,
    item: SignalPlayoutItem,
    readinessKind: "initial" | "committed",
  ): ProcessBinding {
    const forwarder = new MpegTsPacketForwarder(
      process.output,
      this.sessionOutput,
    );
    const inspector = this.options.createReadinessInspector();
    let usableOutputSeen = false;
    let readinessTimer: ScheduledTask | undefined;
    const inspect = (chunk: Buffer | Uint8Array | string): void => {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      if (!inspector.observe(bytes)) return;

      usableOutputSeen = true;
      cancelReadiness();
      if (readinessKind === "initial") {
        this.options.logger.info("signal_initial_output_ready", context);
        this.settleReadySuccessfully();
      } else {
        this.options.logger.info("signal_committed_item_ready", context);
      }
    };
    const cancelReadiness = (): void => {
      process.output.off("data", inspect);
      readinessTimer?.cancel();
      readinessTimer = undefined;
    };
    const context = itemContext(item);
    const binding: ProcessBinding = {
      process,
      forwarder,
      context,
      cancelReadiness,
    };
    this.bindings.set(process, binding);
    process.output.on("data", inspect);
    if (readinessKind === "committed") {
      readinessTimer = this.options.timers.setTimeout(
        () => this.fail(itemReadinessTimeout()),
        this.options.itemReadinessTimeoutMs,
      );
    }
    const release = (): void => {
      cancelReadiness();
      this.bindings.delete(process);
    };
    void process.completion.then(
      () => {
        release();
        if (!usableOutputSeen && !this.stopping) {
          this.fail(prematureExit());
        }
      },
      (error: unknown) => {
        release();
        this.fail(error);
      },
    );
    return binding;
  }

  /** Resolves initial readiness once without affecting later item inspection. */
  private settleReadySuccessfully(): void {
    if (this.readySettled) return;
    this.readySettled = true;
    this.resolveReady();
  }

  /** Retries process cleanup as a unit while preserving failed handles. */
  private async stopAllProcesses(): Promise<void> {
    await Promise.all(
      [...this.bindings.keys()].map((process) => process.stop()),
    );
    this.stopped = true;
    this.sessionOutput.end();
    if (!this.completionSettled) {
      this.completionSettled = true;
      this.options.logger.info("signal_session_stopped", this.active.context);
      this.resolveCompletion();
    }
  }

  /** Converts any FFmpeg process or commit failure into the session's terminal result. */
  private fail(error: unknown): void {
    if (this.completionSettled || this.stopping) return;
    this.settleReadyWithError(error);
    this.completionSettled = true;
    for (const binding of this.bindings.values()) {
      binding.cancelReadiness();
      binding.forwarder.detach();
    }
    this.sessionOutput.end();
    this.options.logger.info("signal_session_failed", this.active.context);
    this.rejectCompletion(error);
    for (const process of this.bindings.keys()) {
      void process.stop().catch(() => undefined);
    }
  }

  /** Rejects initial readiness once; later failures leave it settled. */
  private settleReadyWithError(error: unknown): void {
    if (this.readySettled) return;
    this.readySettled = true;
    this.rejectReady(error);
  }

  /** Refuses all new work once stop or fatal failure owns the session. */
  private assertRunning(): void {
    if (this.stopping || this.stopped || this.completionSettled) {
      throw packagingStoppedError();
    }
  }

  /** Prevents stale preparation handles from mutating this session. */
  private assertCurrentPreparation(preparation: FfmpegSignalPreparation): void {
    if (this.preparation !== preparation) {
      throw new Error("Preparation is not owned by this session");
    }
  }
}
