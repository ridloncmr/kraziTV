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
import { failureSummary, itemContext } from "./item-log-context.js";
import {
  itemReadinessTimeout,
  outputStalled,
  prematureExit,
  preparedOutputOverflow,
} from "./packaging-errors.js";

/**
 * How long a prepared program's media check may take before its FFmpeg
 * process starts anyway. A stalled network mount must not hold the
 * preparation, so an unanswered check means FFmpeg itself finds out.
 */
const MEDIA_CHECK_TIMEOUT_MS = 2_000;

/** One FFmpeg process the session owns and how its output reaches the session. */
type ProcessBinding = {
  process: FfmpegProcess;
  /** The item it serves, which a stand-in replacing it serves too. */
  item: SignalPlayoutItem;
  /** Whether it is a stand-in, which nothing replaces in turn. */
  standIn: boolean;
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
  /** Starts watching for silence, which counts only once it airs usable output. */
  watchForStall(): void;
  /** Stops watching for silence, once the process no longer airs. */
  cancelStallWatch(): void;
};

/** The next item, held from its prepare until its commit or discard. */
type PreparedItem = {
  handle: FfmpegSignalPreparation;
  binding: ProcessBinding;
};

/** What a session needs from its packager to start and judge each item's FFmpeg process. */
type FfmpegSignalSessionOptions = {
  /** Decides when the first process makes the session ready for its first viewer. */
  initialReadinessInspector: OutputReadinessInspector;
  /** Decides when each prepared process is ready for its commit. */
  createReadinessInspector: () => OutputReadinessInspector;
  /** Validates an item by building its argv, then starts its FFmpeg process. */
  startProcess: (item: SignalPlayoutItem) => FfmpegProcess;
  /** Starts the offline card for an item that cannot air. */
  startStandIn: (item: SignalPlayoutItem) => FfmpegProcess;
  /** Whether a program's media can be read before its process starts. */
  isMediaPresent: (mediaPath: string) => Promise<boolean>;
  timers: TimerScheduler;
  /** How long a prepared process or a stand-in may stay silent, from its start, before it fails. */
  itemReadinessTimeoutMs: number;
  /** How long an airing process may stop producing output before a stand-in replaces it. */
  outputStallTimeoutMs: number;
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
  /** Set while a prepare waits on its media check, which counts as outstanding. */
  private checkingMedia = false;

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
    this.active = this.attach(
      process,
      initialItem,
      options.initialReadinessInspector,
      this.continuity,
      undefined,
    );
  }

  /**
   * Starts the next item's FFmpeg process now and holds its output until the
   * commit (ADR 0016), so a commit at a boundary known a lead ahead switches
   * to a process already producing packets. Resolves as soon as the process
   * is started: readiness is observed while the output is held, and a
   * process that fails or stays silent before its commit airs a stand-in at
   * that commit. A program whose media cannot be read prepares its stand-in
   * instead of FFmpeg (ADR 0020), so even that boundary is seamless.
   */
  async prepare(item: SignalPlayoutItem): Promise<SignalPreparation> {
    this.assertRunning();
    if (this.preparation !== undefined || this.checkingMedia) {
      throw new Error("Session already has an outstanding preparation");
    }
    this.checkingMedia = true;
    let present: boolean;
    try {
      present = await this.mediaPresent(item);
    } finally {
      this.checkingMedia = false;
    }
    this.assertRunning();
    if (!present) {
      this.options.logger.warn("signal_media_missing", itemContext(item));
    }
    const process = present
      ? this.options.startProcess(item)
      : this.options.startStandIn(item);
    const held = new HeldOutput(this.options.preparedOutputLimitBytes, () =>
      this.fail(preparedOutputOverflow()),
    );
    const prepared: PreparedItem = {
      handle: new FfmpegSignalPreparation(this, item),
      binding: this.attach(
        process,
        item,
        this.options.createReadinessInspector(),
        held,
        held,
        !present,
      ),
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
      this.active.cancelStallWatch();
      for (const binding of this.bindings.values()) {
        binding.cancelReadiness();
      }
      return this.stopAllProcesses();
    });
  }

  /**
   * Makes the prepared process the broadcast's source: the previous process's
   * finished packets go out, then everything the prepared one held, then its
   * live output (ADR 0016). A prepared process that already failed is
   * replaced by its stand-in here (ADR 0020), so the boundary still lands.
   */
  commitPreparation(preparation: FfmpegSignalPreparation): void {
    this.assertRunning();
    const { binding } = this.currentPreparation(preparation);
    this.preparation = undefined;

    const previous = this.active;
    previous.cancelReadiness();
    previous.cancelStallWatch();
    previous.forwarder.detach();
    if (binding.failure === undefined) {
      binding.committed = true;
      this.active = binding;
      binding.held?.release(this.continuity);
      binding.held = undefined;
      binding.watchForStall();
    } else if (binding.standIn) {
      const failure = toSignalError(
        binding.failure,
        "packaging_failed",
        "Prepared stand-in failed before its commit",
        binding.context,
      );
      this.fail(failure);
      throw failure;
    } else {
      this.replaceWithStandIn(binding, binding.failure);
    }
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
   * session-internal, judging its readiness with `inspector`. A live process
   * settles the session's readiness. A prepared one, holding its output in
   * `held`, must produce usable output within the readiness timeout of its
   * start; a failure before its commit is kept for that commit to handle, and
   * one while airing brings in a stand-in. So does an airing process that
   * falls silent after usable output, hung or finished early, since only
   * the next commit may end an item's airtime (ADR 0020).
   */
  private attach(
    process: FfmpegProcess,
    item: SignalPlayoutItem,
    inspector: OutputReadinessInspector,
    sink: PacketSink,
    held: HeldOutput | undefined,
    standIn = false,
  ): ProcessBinding {
    const forwarder = new MpegTsPacketForwarder(process.output, sink);
    const context = itemContext(item);
    let usableOutputSeen = false;
    let readinessTimer: ScheduledTask | undefined;
    let stallTimer: ScheduledTask | undefined;
    const inspect = (chunk: Buffer | Uint8Array | string): void => {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      if (!inspector.observe(bytes)) return;

      usableOutputSeen = true;
      cancelReadiness();
      if (held === undefined) {
        if (!this.readySettled) {
          this.options.logger.info("signal_initial_output_ready", context);
        }
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
    // Restarted by every chunk. A process that exits keeps its watch, so
    // media ending early is caught; a process that no longer airs drops it.
    const watchForStall = (): void => {
      clearStallTimer();
      if (!usableOutputSeen || !binding.committed || binding !== this.active) {
        return;
      }
      stallTimer = this.options.timers.setTimeout(
        () => failed(outputStalled()),
        this.options.outputStallTimeoutMs,
      );
    };
    const clearStallTimer = (): void => {
      stallTimer?.cancel();
      stallTimer = undefined;
    };
    const cancelStallWatch = (): void => {
      process.output.off("data", watchForStall);
      clearStallTimer();
    };
    const binding: ProcessBinding = {
      process,
      item,
      standIn,
      forwarder,
      held,
      context,
      committed: held === undefined,
      discarded: false,
      cancelReadiness,
      watchForStall,
      cancelStallWatch,
    };
    // A failure while the process feeds the broadcast brings in a stand-in,
    // and one of the stand-in itself ends the session; a process already
    // replaced no longer matters. Before its commit a failure is kept for that
    // commit, and the process is stopped, while the airing item plays on; a
    // discarded preparation reports nothing.
    const failed = (error: unknown): void => {
      cancelReadiness();
      cancelStallWatch();
      if (binding.committed) {
        if (binding !== this.active) return;
        if (binding.standIn) this.fail(error);
        else this.replaceWithStandIn(binding, error);
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
    process.output.on("data", watchForStall);
    // The first process has the worker's startup timeout instead.
    if (held !== undefined || standIn) {
      readinessTimer = this.options.timers.setTimeout(
        () => failed(itemReadinessTimeout()),
        this.options.itemReadinessTimeoutMs,
      );
    }
    const release = (): void => {
      cancelReadiness();
      process.output.off("data", watchForStall);
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

  /**
   * Airs the offline card in place of an item whose FFmpeg process failed, so one bad file never ends the broadcast signal (ADR 0020). The
   * stand-in runs until the worker's next commit, as the item would have;
   * one that cannot start ends the session.
   */
  private replaceWithStandIn(failed: ProcessBinding, error: unknown): void {
    if (this.stopping || this.completionSettled) return;
    failed.forwarder.detach();
    void failed.process.stop().catch(() => undefined);
    this.options.logger.warn("signal_item_replaced_by_stand_in", {
      ...failed.context,
      ...failureSummary(error),
    });
    let process: FfmpegProcess;
    try {
      process = this.options.startStandIn(failed.item);
    } catch (cause) {
      this.fail(cause);
      return;
    }
    this.active = this.attach(
      process,
      failed.item,
      this.options.createReadinessInspector(),
      this.continuity,
      undefined,
      true,
    );
  }

  /**
   * Answers whether a program's media can be read, within the check's
   * timeout; filler reads nothing. A check that errors or stays unanswered
   * counts as present, so only a clear "missing" skips FFmpeg.
   */
  private async mediaPresent(item: SignalPlayoutItem): Promise<boolean> {
    if (item.kind === "filler") return true;
    let timer: ScheduledTask | undefined;
    const unanswered = new Promise<boolean>((resolve) => {
      timer = this.options.timers.setTimeout(
        () => resolve(true),
        MEDIA_CHECK_TIMEOUT_MS,
      );
    });
    try {
      return await Promise.race([
        this.options.isMediaPresent(item.mediaPath).catch(() => true),
        unanswered,
      ]);
    } finally {
      timer?.cancel();
    }
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
    this.active.cancelStallWatch();
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
