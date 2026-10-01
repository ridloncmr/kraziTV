import type {
  SignalPlayoutItem,
  SignalPreparation,
} from "../../signal-packager/contracts.js";

/** The session side a preparation hands its decision to. */
export interface PreparationOwner {
  commitPreparation(preparation: FfmpegSignalPreparation): void;
  discardPreparation(preparation: FfmpegSignalPreparation): void;
}

type PreparationState = "pending" | "committed" | "discarded";

/** Holds a validated future item without starting an encoder before commit. */
export class FfmpegSignalPreparation implements SignalPreparation {
  private state: PreparationState = "pending";

  /** Binds the item to the session that validated it. */
  constructor(
    private readonly owner: PreparationOwner,
    readonly item: SignalPlayoutItem,
  ) {}

  /** Irrevocably hands the validated item to its owning session. */
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

  /** Releases this preparation without allocating an encoder. */
  async discard(): Promise<void> {
    if (this.state !== "pending") return;
    this.owner.discardPreparation(this);
    this.state = "discarded";
  }
}
