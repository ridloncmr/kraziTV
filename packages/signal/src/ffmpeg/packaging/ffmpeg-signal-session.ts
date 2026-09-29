import type { Readable } from "node:stream";

import { SignalError } from "../../errors.js";
import type {
  SignalPlayoutItem,
  SignalPreparation,
  SignalSession,
} from "../../signal-packager/contracts.js";
import type { OutputReadinessInspector } from "../mpeg-ts/mpeg-ts-readiness-inspector.js";
import type { FfmpegProcess } from "../process/ffmpeg-process.js";

/** Owns readiness and stop semantics for a single FFmpeg playout item. */
export class FfmpegSignalSession implements SignalSession {
  readonly output: Readable;
  readonly ready: Promise<void>;
  readonly completion: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (reason: unknown) => void;
  private readySettled = false;
  private stopPromise: Promise<void> | undefined;

  /** Attaches inspection and completion observers before returning output. */
  constructor(
    private readonly process: FfmpegProcess,
    private readonly readinessInspector: OutputReadinessInspector,
  ) {
    this.output = process.output;
    this.completion = process.completion;
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.output.on("data", this.inspectOutput);
    void this.process.completion.then(
      () => undefined,
      (error: unknown) => this.settleReadyWithError(error),
    );
  }

  /** Defers multi-item mechanics to SIG-008 without changing initial output. */
  async prepare(_item: SignalPlayoutItem): Promise<SignalPreparation> {
    throw new SignalError(
      "packaging_failed",
      "Signal item preparation is not implemented",
      { reason: "preparation_not_implemented" },
    );
  }

  /** Rejects readiness, shares active cleanup, and permits failed retries. */
  stop(): Promise<void> {
    if (this.stopPromise !== undefined) return this.stopPromise;

    this.settleReadyWithError(
      new SignalError(
        "packaging_stopped",
        "Signal packaging stopped before readiness",
      ),
    );
    const attempt = this.process.stop();
    this.stopPromise = attempt;
    void attempt.catch(() => {
      if (this.stopPromise === attempt) this.stopPromise = undefined;
    });
    return attempt;
  }

  /** Resolves readiness only when the configured output strategy accepts bytes. */
  private readonly inspectOutput = (
    chunk: Buffer | Uint8Array | string,
  ): void => {
    if (this.readySettled) return;
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    if (!this.readinessInspector.observe(bytes)) return;

    this.readySettled = true;
    this.output.off("data", this.inspectOutput);
    this.resolveReady();
  };

  /** Settles failure once and detaches inspection without altering process output. */
  private settleReadyWithError(error: unknown): void {
    if (this.readySettled) return;
    this.readySettled = true;
    this.output.off("data", this.inspectOutput);
    this.rejectReady(error);
  }
}
