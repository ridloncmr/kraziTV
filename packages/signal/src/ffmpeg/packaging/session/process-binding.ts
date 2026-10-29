import type { ScheduledTask, TimerScheduler } from "../../../runtime/clock.js";
import type { LogContext } from "../../../runtime/signal-logger.js";
import type { SignalPlayoutItem } from "../../../signal-packager/contracts.js";
import type { OutputReadinessInspector, PacketSink } from "../../contracts.js";
import { MpegTsPacketForwarder } from "../../mpeg-ts/mpeg-ts-packet-forwarder.js";
import type { FfmpegProcess } from "../../process/ffmpeg-process.js";
import type { HeldOutput } from "./held-output.js";
import { itemContext } from "./item-log-context.js";
import { itemReadinessTimeout, prematureExit } from "./packaging-errors.js";

/**
 * What a binding reports to its session, which decides what each means for
 * the broadcast. The binding stops its own timers before reporting a failure.
 */
export type ProcessBindingEvents = {
  /** The process produced usable output for the first time. */
  onReady(binding: ProcessBinding): void;
  /** The process ended, cleanly or not, so the session no longer owns it. */
  onExited(binding: ProcessBinding): void;
  /** The process failed, exited before usable output, or missed its readiness timeout. */
  onFailed(binding: ProcessBinding, error: unknown): void;
  /** The watched process stayed silent past the stall timeout. */
  onStalled(binding: ProcessBinding): void;
};

/** What a binding needs to forward, judge, and time one FFmpeg process. */
type ProcessBindingOptions = {
  process: FfmpegProcess;
  /** The item it serves, which a stand-in replacing it serves too. */
  item: SignalPlayoutItem;
  /** Whether it is a stand-in, which nothing replaces in turn. */
  standIn: boolean;
  /** Where a prepared process's output waits for its commit; none for a live one. */
  held: HeldOutput | undefined;
  /** Where a live process's packets go: the broadcast. */
  output: PacketSink;
  inspector: OutputReadinessInspector;
  timers: TimerScheduler;
  /** How long it may stay silent from its start; none for a process the worker's startup timeout covers. */
  readinessTimeoutMs: number | undefined;
  /** How long a watched process may stop producing output before it stalls. */
  stallTimeoutMs: number;
  events: ProcessBindingEvents;
};

/**
 * One FFmpeg process the session owns and how its output reaches the
 * session. It owns the process's readiness timer, its stall timer, and
 * whether it has produced usable output; the session decides what a
 * readiness, failure, or stall means while the process airs (ADR 0016,
 * ADR 0020).
 */
export class ProcessBinding {
  readonly process: FfmpegProcess;
  readonly item: SignalPlayoutItem;
  readonly standIn: boolean;
  readonly forwarder: MpegTsPacketForwarder;
  readonly context: LogContext;
  /** Whether it started as a preparation, its output held for a commit. */
  readonly prepared: boolean;
  /** Where a prepared process's output waits for its commit; none once live. */
  held: HeldOutput | undefined;
  /** Whether the process feeds the broadcast yet; a prepared one does not. */
  committed: boolean;
  /** Set once the worker discarded the preparation, so a late end means nothing. */
  discarded = false;
  /** Why the process ended or stayed silent before its commit, which that commit reports. */
  failure: unknown;
  private usableOutputSeen = false;
  /** Whether output still goes through the readiness inspector. */
  private inspecting = true;
  /**
   * Whether the session has asked for silence to be timed. The session must
   * clear it, through cancelStallWatch or release, on every path that takes
   * the binding off the air, or a chunk would arm a stall timer for a binding
   * that no longer airs.
   */
  private watching: boolean;
  private readinessTimer: ScheduledTask | undefined;
  private stallTimer: ScheduledTask | undefined;
  private readonly inspector: OutputReadinessInspector;
  private readonly timers: TimerScheduler;
  private readonly stallTimeoutMs: number;
  private readonly events: ProcessBindingEvents;

  /**
   * Starts forwarding and inspecting the process's output, and its readiness
   * timer when it has one. A live process is watched for silence from the
   * start; a prepared one only once committed.
   */
  constructor(options: ProcessBindingOptions) {
    this.process = options.process;
    this.item = options.item;
    this.standIn = options.standIn;
    this.held = options.held;
    this.prepared = options.held !== undefined;
    this.committed = !this.prepared;
    this.watching = !this.prepared;
    this.context = itemContext(options.item);
    this.inspector = options.inspector;
    this.timers = options.timers;
    this.stallTimeoutMs = options.stallTimeoutMs;
    this.events = options.events;
    // The forwarder listens first, so each chunk is forwarded before it is judged.
    this.forwarder = new MpegTsPacketForwarder(
      options.process.output,
      options.held ?? options.output,
    );
    options.process.output.on("data", this.observe);
    if (options.readinessTimeoutMs !== undefined) {
      this.readinessTimer = options.timers.setTimeout(
        () => this.fail(itemReadinessTimeout()),
        options.readinessTimeoutMs,
      );
    }
    void options.process.completion.then(
      () => {
        this.exited();
        if (!this.usableOutputSeen) this.fail(prematureExit());
      },
      (error: unknown) => {
        this.exited();
        this.fail(error);
      },
    );
  }

  /** Makes a prepared process live: what it held goes to `output`, then everything after. */
  commit(output: PacketSink): void {
    this.committed = true;
    this.held?.release(output);
    this.held = undefined;
    this.watchForStall();
  }

  /**
   * Takes the process off the broadcast: its timers stop, its finished
   * packets go out, what it held is dropped, and it is stopped.
   * `onStopFailure` is the caller's policy for a stop that fails: ignore it,
   * end the session, or rethrow it to a caller that retries.
   */
  release(onStopFailure: (error: unknown) => void): Promise<void> {
    this.cancelReadiness();
    this.cancelStallWatch();
    this.forwarder.detach();
    this.held?.discard();
    return this.process.stop().catch(onStopFailure);
  }

  /** Stops judging readiness, once the process's readiness no longer matters. */
  cancelReadiness(): void {
    this.inspecting = false;
    this.readinessTimer?.cancel();
    this.readinessTimer = undefined;
  }

  /**
   * Times silence while the process airs. Every chunk restarts the timer, and
   * silence counts only once usable output was seen.
   */
  watchForStall(): void {
    this.watching = true;
    this.restartStallTimer();
  }

  /** Stops timing silence, once the process no longer airs. */
  cancelStallWatch(): void {
    this.watching = false;
    this.stallTimer?.cancel();
    this.stallTimer = undefined;
  }

  /** Judges readiness from each chunk until it is settled, and restarts the stall timer. */
  private readonly observe = (chunk: Buffer | Uint8Array | string): void => {
    if (this.inspecting) {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      if (this.inspector.observe(bytes)) {
        this.usableOutputSeen = true;
        this.cancelReadiness();
        this.events.onReady(this);
      }
    }
    this.restartStallTimer();
  };

  /** Arms the stall timer afresh when the process is watched and has produced usable output. */
  private restartStallTimer(): void {
    this.stallTimer?.cancel();
    this.stallTimer = undefined;
    if (!this.watching || !this.usableOutputSeen) return;
    this.stallTimer = this.timers.setTimeout(() => {
      this.stallTimer = undefined;
      this.events.onStalled(this);
    }, this.stallTimeoutMs);
  }

  /**
   * Stops observing an ended process. Its stall timer keeps running, so media
   * that ends early is caught as silence.
   */
  private exited(): void {
    this.cancelReadiness();
    this.process.output.off("data", this.observe);
    this.events.onExited(this);
  }

  /** Stops every timer and observation before reporting the failure. */
  private fail(error: unknown): void {
    this.cancelReadiness();
    this.cancelStallWatch();
    this.process.output.off("data", this.observe);
    this.events.onFailed(this, error);
  }
}
