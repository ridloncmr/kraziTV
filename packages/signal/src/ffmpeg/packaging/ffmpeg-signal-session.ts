import { PassThrough, type Readable } from "node:stream";

import { packagingStoppedError, toSignalError } from "../../errors.js";
import type {
  SignalPlayoutItem,
  SignalPreparation,
  SignalSession,
} from "../../signal-packager/contracts.js";
import type { ScheduledTask, TimerScheduler } from "../../runtime/clock.js";
import { RetryableAttempt } from "../../runtime/retryable-attempt.js";
import type { LogContext, SignalLogger } from "../../runtime/signal-logger.js";
import { MpegTsContinuity } from "../mpeg-ts/mpeg-ts-continuity.js";
import { MpegTsPacketForwarder } from "../mpeg-ts/mpeg-ts-packet-forwarder.js";
import type { OutputReadinessInspector, PacketSink } from "../contracts.js";
import type { FfmpegProcess } from "../process/ffmpeg-process.js";
import {
  FfmpegSignalPreparation,
  type PreparationOwner,
} from "./ffmpeg-signal-preparation.js";
import { HeldOutput } from "./held-output.js";
import { itemContext } from "./item-log-context.js";
import {
  itemReadinessTimeout,
  prematureExit,
  preparedOutputOverflow,
} from "./packaging-errors.js";

/** One FFmpeg process the session owns and how its output reaches the session. */
type ProcessBinding = {
  process: FfmpegProcess;
  forwarder: MpegTsPacketForwarder;
  /** Where a prepared process's output waits for its commit; none once live. */
  held: HeldOutput | undefined;
  context: LogContext;
  /** Whether the process feeds the broadcast yet; a prepared one does not. */
  committed: boolean;
  /** Set once the worker discarded the preparation, so a late end means nothing. */
  discarded: boolean;
  /** Why the process ended or stayed silent before its commit, which that commit reports. */
  failure?: unknown;
  cancelReadiness(): void;
};

/** The next item, held from its prepare until its commit or discard. */
type PreparedItem = {
  handle: FfmpegSignalPreparation;
  binding: ProcessBinding;
};

/** What a session needs from its packager to start and judge each item's FFmpeg process. */
type FfmpegSignalSessionOptions = {
  createReadinessInspector: () => OutputReadinessInspector;
  /** Validates an item by building its argv, then starts its FFmpeg process. */
  startProcess: (item: SignalPlayoutItem) => FfmpegProcess;
  timers: TimerScheduler;
  /** How long a prepared process may stay silent, from its start, before it fails. */
  itemReadinessTimeoutMs: number;
  /** How much output a prepared process may hold before its commit. */
  preparedOutputLimitBytes: number;
  logger: SignalLogger;
};

/** Owns one stable output while sequential FFmpeg processes serve its items. */
export class FfmpegSignalSession implements SignalSession, PreparationOwner {
  readonly output: Readable;
  readonly ready: Promise<void>;
  readonly completion: Promise<void>;
  private readonly sessionOutput = new PassThrough();
  private readonly bindings = new Map<FfmpegProcess, ProcessBinding>();
  /** Continues each stream's counters across every process, at the output. */
  private readonly continuity = new MpegTsContinuity(this.sessionOutput);
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
  private preparation: PreparedItem | undefined;

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
    this.active = this.attach(process, initialItem, this.continuity, undefined);
  }

  /**
   * Starts the next item's FFmpeg process now and holds its output until the
   * commit (ADR 0016), so a commit at a boundary known a lead ahead switches
   * to a process already producing packets. Resolves as soon as the process
   * is started: readiness is observed while the output is held, and a
   * process that fails or stays silent before its commit fails that commit.
   */
  async prepare(item: SignalPlayoutItem): Promise<SignalPreparation> {
    this.assertRunning();
    if (this.preparation !== undefined) {
      throw new Error("Session already has an outstanding preparation");
    }
    const process = this.options.startProcess(item);
    const held = new HeldOutput(this.options.preparedOutputLimitBytes, () =>
      this.fail(preparedOutputOverflow()),
    );
    const prepared: PreparedItem = {
      handle: new FfmpegSignalPreparation(this, item),
      binding: this.attach(process, item, held, held),
    };
    this.preparation = prepared;
    return prepared.handle;
  }

  /** Stops every FFmpeg process and ends the stable output only after verified closure. */
  stop(): Promise<void> {
    return this.stopAttempt.run(() => {
      this.stopping = true;
      this.settleReadyWithError(packagingStoppedError());
      if (this.preparation !== undefined) {
        void this.preparation.handle.discard().catch(() => undefined);
      }
      for (const binding of this.bindings.values()) {
        binding.cancelReadiness();
      }
      return this.stopAllProcesses();
    });
  }

  /**
   * Makes the prepared process the broadcast's source: the previous process's
   * finished packets go out, then everything the prepared one held, then its
   * live output (ADR 0016). A prepared process that already failed fails the
   * session here, as one that could not start did.
   */
  commitPreparation(preparation: FfmpegSignalPreparation): void {
    this.assertRunning();
    const { binding } = this.currentPreparation(preparation);
    this.preparation = undefined;
    if (binding.failure !== undefined) {
      const failure = toSignalError(
        binding.failure,
        "packaging_failed",
        "Prepared FFmpeg process failed before its commit",
        binding.context,
      );
      this.fail(failure);
      throw failure;
    }

    const previous = this.active;
    previous.forwarder.detach();
    binding.committed = true;
    this.active = binding;
    binding.held?.release(this.continuity);
    binding.held = undefined;
    this.options.logger.info("signal_transition_committed", binding.context);
    void previous.process.stop().catch((error: unknown) => this.fail(error));
  }

  /**
   * Stops the prepared process and drops what it held. The preparation stays
   * outstanding until the stop succeeds, so a retry can finish it and no
   * second preparation starts meanwhile.
   */
  async discardPreparation(
    preparation: FfmpegSignalPreparation,
  ): Promise<void> {
    const prepared = this.currentPreparation(preparation);
    const { binding } = prepared;
    binding.discarded = true;
    binding.cancelReadiness();
    binding.forwarder.detach();
    binding.held?.discard();
    await binding.process.stop();
    if (this.preparation === prepared) this.preparation = undefined;
  }

  /**
   * Attaches packet forwarding to `sink` and observes one FFmpeg process as
   * session-internal. The initial process settles the session's readiness. A
   * prepared one, holding its output in `held`, must produce usable output
   * within the readiness timeout of its start; a failure before its commit is
   * kept for that commit to report, and one after ends the session.
   */
  private attach(
    process: FfmpegProcess,
    item: SignalPlayoutItem,
    sink: PacketSink,
    held: HeldOutput | undefined,
  ): ProcessBinding {
    const forwarder = new MpegTsPacketForwarder(process.output, sink);
    const inspector = this.options.createReadinessInspector();
    const context = itemContext(item);
    let usableOutputSeen = false;
    let readinessTimer: ScheduledTask | undefined;
    const inspect = (chunk: Buffer | Uint8Array | string): void => {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      if (!inspector.observe(bytes)) return;

      usableOutputSeen = true;
      cancelReadiness();
      if (held === undefined) {
        this.options.logger.info("signal_initial_output_ready", context);
        this.settleReadySuccessfully();
      } else {
        this.options.logger.info("signal_prepared_item_ready", context);
      }
    };
    const cancelReadiness = (): void => {
      process.output.off("data", inspect);
      readinessTimer?.cancel();
      readinessTimer = undefined;
    };
    const binding: ProcessBinding = {
      process,
      forwarder,
      held,
      context,
      committed: held === undefined,
      discarded: false,
      cancelReadiness,
    };
    // A failure once the process feeds the broadcast ends the session. Before
    // that it is kept for the commit to report, and the process is stopped,
    // while the airing item plays on; a discarded preparation reports nothing.
    const failed = (error: unknown): void => {
      cancelReadiness();
      if (binding.committed) {
        this.fail(error);
        return;
      }
      if (binding.discarded || binding.failure !== undefined) return;
      binding.failure = error;
      forwarder.detach();
      binding.held?.discard();
      void process.stop().catch(() => undefined);
    };
    this.bindings.set(process, binding);
    process.output.on("data", inspect);
    if (held !== undefined) {
      readinessTimer = this.options.timers.setTimeout(
        () => failed(itemReadinessTimeout()),
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
        if (!usableOutputSeen && !this.stopping) failed(prematureExit());
      },
      (error: unknown) => {
        release();
        failed(error);
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

  /** The outstanding preparation this handle names; a stale handle never changes the session. */
  private currentPreparation(
    preparation: FfmpegSignalPreparation,
  ): PreparedItem {
    if (this.preparation?.handle !== preparation) {
      throw new Error("Preparation is not owned by this session");
    }
    return this.preparation;
  }
}
