import type {
  ChannelAuthorization,
  ChannelAuthorizationResult,
} from "../channel-worker/contracts.js";
import type { ChannelId } from "../playout/contracts.js";

type ArrangedResult =
  ChannelAuthorizationResult | Promise<ChannelAuthorizationResult>;

/**
 * The one channel-authorization double the signal tests share. Unscripted it
 * enables every channel it is asked about; `setResult` fixes one answer for a
 * race to observe, `disable` mirrors an administrative disable, and
 * `sequence` hands out arranged answers in order so a lookup can be held in
 * flight through a pending promise. Every lookup is recorded.
 */
export class ScriptedAuthorization implements ChannelAuthorization {
  readonly calls: ChannelId[] = [];
  private readonly arranged: ArrangedResult[] = [];
  private sequenced = false;
  private readonly disabled = new Set<ChannelId>();

  /** A fixed answer applies to every channel until `setResult` changes it. */
  constructor(private fixed?: ChannelAuthorizationResult) {}

  /** Answers in order; once arranged, running out is a test error. */
  static sequence(results: readonly ArrangedResult[]): ScriptedAuthorization {
    const authorization = new ScriptedAuthorization();
    authorization.sequenced = true;
    authorization.arranged.push(...results);
    return authorization;
  }

  /** Lets race tests change the state observed at publication. */
  setResult(result: ChannelAuthorizationResult): void {
    this.fixed = result;
  }

  /** Mirrors an administrative disable that later lookups observe. */
  disable(channelId: ChannelId): void {
    this.disabled.add(channelId);
  }

  /** Records the lookup, then answers from the sequence, the fixed answer, or by enabling the channel. */
  async getChannelAuthorization(
    channelId: ChannelId,
  ): Promise<ChannelAuthorizationResult> {
    this.calls.push(channelId);
    if (this.sequenced) {
      const next = this.arranged.shift();
      if (next === undefined) {
        throw new Error("No authorization result was arranged");
      }
      return next;
    }
    if (this.disabled.has(channelId)) return { status: "disabled", channelId };
    return this.fixed ?? { status: "enabled", channelId };
  }
}
