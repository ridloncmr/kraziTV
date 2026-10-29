import { PassThrough, type Readable } from "node:stream";

import { packagingStoppedError, toSignalError } from "../../../errors.js";
import type {
  SignalPlayoutItem,
  SignalPreparation,
  SignalSession,
} from "../../../signal-packager/contracts.js";
import type { ScheduledTask, TimerScheduler } from "../../../runtime/clock.js";
import { RetryableAttempt } from "../../../runtime/retryable-attempt.js";
import type { SignalLogger } from "../../../runtime/signal-logger.js";
import { MpegTsContinuity } from "../../mpeg-ts/mpeg-ts-continuity.js";
import { MpegTsRejoinGate } from "../../mpeg-ts/mpeg-ts-rejoin-gate.js";
import { MpegTsTimestamps } from "../../mpeg-ts/mpeg-ts-timestamps.js";
import type { OutputReadinessInspector } from "../../contracts.js";
import type { FfmpegProcess } from "../../process/ffmpeg-process.js";
import { FfmpegSignalPreparation } from "./ffmpeg-signal-preparation.js";
import { HeldOutput } from "./held-output.js";
import { failureSummary, itemContext } from "./item-log-context.js";
import { outputStalled, preparedOutputOverflow } from "./packaging-errors.js";
import {
  ProcessBinding,
  type ProcessBindingEvents,
} from "./process-binding.js";

/**
 * How long a prepared program's media check may take before its FFmpeg
 * process starts anyway. A stalled network mount must not hold the
 * preparation, so an unanswered check means FFmpeg itself finds out.
 */
const MEDIA_CHECK_TIMEOUT_MS = 2_000;

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
export class FfmpegSignalSession implements SignalSession {
  readonly output: Readable;
  readonly ready: Promise<void>;
  readonly completion: Promise<void>;
  private readonly sessionOutput = new PassThrough();
  private readonly bindings = new Map<FfmpegProcess, ProcessBinding>();
  /**
   * Where every process's packets reach the output: its timestamps moved
   * onto one forward timeline (ADR 0021), then each stream's counters
   * continued. Each place a different process starts feeding it splices.
   */
  private readonly packetOutput = new MpegTsTimestamps(
    new MpegTsContinuity(this.sessionOutput),
  );
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
  /** A stalled item set aside behind its stand-in, in case it writes again. */
  private suspended: ProcessBinding | undefined;
  /** How the session hears from every process it binds. */
  private readonly bindingEvents: ProcessBindingEvents = {
    onReady: (binding) => this.itemReady(binding),
    onExited: (binding) => this.itemExited(binding),
    onFailed: (binding, error) => this.itemFailed(binding, error),
    onStalled: (binding) => this.itemStalled(binding),
  };

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
   * replaced by its stand-in here (ADR 0020), so the boundary still lands,
   * and a stalled item still set aside has lost its airtime and is stopped.
   */
  commitPreparation(preparation: FfmpegSignalPreparation): void {
    this.assertRunning();
    const { binding } = this.currentPreparation(preparation);
    this.preparation = undefined;

    // The previous process's finished packets go out before anything new.
    // The set-aside item is forgotten before it is retired, because retiring
    // flushes its finished packets into its rejoin gate, which must not
    // bring it back now that its airtime is over.
    this.retire(this.active);
    const suspended = this.suspended;
    this.suspended = undefined;
    if (suspended !== undefined) this.retire(suspended);
    if (binding.failure === undefined) {
      this.active = binding;
      this.packetOutput.splice();
      binding.commit(this.packetOutput);
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
    prepared.binding.discarded = true;
    await prepared.binding.release((error) => {
      throw error;
    });
    if (this.preparation === prepared) this.preparation = undefined;
  }

  /**
   * Binds one FFmpeg process as session-internal, judging its readiness with
   * `inspector`. A live process feeds the broadcast; a prepared one holds its
   * output in `held` and, like a stand-in, must produce usable output within
   * the readiness timeout of its start. The first process has the worker's
   * startup timeout instead.
   */
  private attach(
    process: FfmpegProcess,
    item: SignalPlayoutItem,
    inspector: OutputReadinessInspector,
    held: HeldOutput | undefined,
    standIn = false,
  ): ProcessBinding {
    const binding = new ProcessBinding({
      process,
      item,
      standIn,
      held,
      output: this.packetOutput,
      inspector,
      timers: this.options.timers,
      readinessTimeoutMs:
        held !== undefined || standIn
          ? this.options.itemReadinessTimeoutMs
          : undefined,
      stallTimeoutMs: this.options.outputStallTimeoutMs,
      events: this.bindingEvents,
    });
    this.bindings.set(process, binding);
    return binding;
  }

  /**
   * A live process's first usable output makes the session ready for its
   * first viewer; a prepared one's is only logged, since its commit decides.
   */
  private itemReady(binding: ProcessBinding): void {
    if (binding.prepared) {
      this.options.logger.info("signal_prepared_item_ready", binding.context);
      return;
    }
    if (!this.readySettled) {
      this.options.logger.info("signal_initial_output_ready", binding.context);
    }
    this.settleReadySuccessfully();
  }

  /** Forgets an ended process, which nothing needs to stop or bring back now. */
  private itemExited(binding: ProcessBinding): void {
    this.bindings.delete(binding.process);
    if (this.suspended === binding) this.suspended = undefined;
  }

  /**
   * A failure while the process feeds the broadcast brings in a stand-in,
   * and one of the stand-in itself ends the session; a process already
   * replaced no longer matters, nor does any failure once the session is
   * ending. Before its commit a failure is kept for that commit, and the
   * process is stopped, while the airing item plays on; a discarded
   * preparation reports nothing (ADR 0020).
   */
  private itemFailed(binding: ProcessBinding, error: unknown): void {
    if (binding.committed) {
      if (binding !== this.active) return;
      if (binding.standIn) this.fail(error);
      else this.replaceWithStandIn(binding, error);
      return;
    }
    if (binding.discarded || binding.failure !== undefined) return;
    binding.failure = error;
    void binding.release(() => undefined);
  }

  /**
   * A silent stand-in ends the session. A silent item airs one, hung or
   * finished early, since only the next commit may end an item's airtime;
   * one whose process still runs is set aside rather than stopped, since a
   * slow read may recover (ADR 0020).
   */
  private itemStalled(binding: ProcessBinding): void {
    if (binding !== this.active) return;
    if (binding.standIn) this.fail(outputStalled());
    else {
      this.replaceWithStandIn(
        binding,
        outputStalled(),
        this.bindings.has(binding.process),
      );
    }
  }

  /**
   * Airs the offline card in place of an item whose FFmpeg process failed,
   * so one bad file never ends the broadcast signal (ADR 0020). The
   * stand-in runs until the worker's next commit, as the item would have;
   * one that cannot start ends the session. A `resumable` item's process is
   * kept, its output gated until a clean entry point brings it back.
   */
  private replaceWithStandIn(
    failed: ProcessBinding,
    error: unknown,
    resumable = false,
  ): void {
    if (this.stopping || this.completionSettled) return;
    if (resumable) {
      failed.cancelStallWatch();
      this.suspended = failed;
      failed.forwarder.redirect(
        new MpegTsRejoinGate((packets) => this.resume(failed, packets)),
      );
    } else {
      void failed.release(() => undefined);
    }
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
    this.packetOutput.splice();
    this.active = this.attach(
      process,
      failed.item,
      this.options.createReadinessInspector(),
      undefined,
      true,
    );
  }

  /**
   * Returns a set-aside item to the broadcast at the clean entry point its
   * gate found, ending the stand-in that covered for it. The item resumes
   * where it froze, so the next commit, still on time, cuts its last
   * seconds instead of the viewer losing the rest of it (ADR 0020).
   */
  private resume(binding: ProcessBinding, packets: Buffer): void {
    if (this.suspended !== binding || this.stopping || this.completionSettled) {
      return;
    }
    this.suspended = undefined;
    this.retire(this.active);
    this.packetOutput.splice();
    this.packetOutput.write(packets);
    binding.forwarder.redirect(this.packetOutput);
    this.active = binding;
    binding.watchForStall();
    this.options.logger.info("signal_item_resumed", binding.context);
  }

  /**
   * Takes a process off the broadcast for good; a failure to stop it ends
   * the session like any cleanup failure.
   */
  private retire(binding: ProcessBinding): void {
    void binding.release((error) => this.fail(error));
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
