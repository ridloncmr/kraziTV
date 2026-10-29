import type {
  SignalPlayoutItem,
  SignalPreparation,
} from "../../../signal-packager/contracts.js";
import type { FfmpegSignalSession } from "./ffmpeg-signal-session.js";

type PreparationState = "pending" | "committed" | "discarded";

/**
 * The next item's FFmpeg process, started ahead of its boundary with its
 * output held, until the worker commits or discards it (ADR 0016).
 */
export class FfmpegSignalPreparation implements SignalPreparation {
  private state: PreparationState = "pending";

  /** Binds the item to the session that started its process and owns its decision. */
  constructor(
    private readonly owner: FfmpegSignalSession,
    readonly item: SignalPlayoutItem,
  ) {}

  /** Irrevocably makes the held process the session's output. */
  commit(): void {
    if (this.state === "committed") {
      throw new Error("Preparation was already committed");
    }
    if (this.state === "discarded") {
      throw new Error("Preparation was already discarded");
    }
    this.state = "committed";
    this.owner.commitPreparation(this);
  }

  /**
   * Stops the held process and drops its output. A failed stop leaves the
   * preparation pending, so a retry finishes it and nothing else starts
   * meanwhile.
   */
  async discard(): Promise<void> {
    if (this.state !== "pending") return;
    await this.owner.discardPreparation(this);
    this.state = "discarded";
  }
}
