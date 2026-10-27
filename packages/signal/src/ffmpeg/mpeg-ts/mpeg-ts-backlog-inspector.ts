import type { Clock } from "../../runtime/clock.js";
import type { OutputReadinessInspector } from "../contracts.js";
import {
  MPEG_TS_PACKET_BYTES,
  startsVideoKeyframe,
} from "./mpeg-ts-packet-run.js";

/**
 * Holds a session's first process unready until it has written its burst
 * backlog, counted in video keyframes, so the first viewer's tune answers
 * with the whole backlog at once (ADR 0018). Plex starts playing on the
 * first frames it gets and stalls again to fill its buffer, so a partial
 * backlog played, stopped, then played. A process too slow to finish its
 * burst is ready anyway once `holdLimitMs` has passed since this inspector
 * was created, as long as it has written a keyframe, so a tune never waits
 * on the burst without bound.
 */
export class MpegTsBacklogInspector implements OutputReadinessInspector {
  private readonly startedAt: number;
  private remainder = Buffer.alloc(0);
  private keyframesSeen = 0;
  private ready = false;

  /** Starts the hold limit now, when the session attaches the process. */
  constructor(
    private readonly keyframes: number,
    private readonly clock: Clock,
    private readonly holdLimitMs: number,
  ) {
    this.startedAt = clock.now();
  }

  /**
   * Counts keyframes in whole packets. FFmpeg's output starts on a packet
   * boundary, so only a chunk's trailing partial packet needs carrying.
   */
  observe(chunk: Uint8Array): boolean {
    if (this.ready) return true;
    const bytes = Buffer.concat([this.remainder, Buffer.from(chunk)]);
    const complete =
      bytes.byteLength - (bytes.byteLength % MPEG_TS_PACKET_BYTES);
    for (let offset = 0; offset < complete; offset += MPEG_TS_PACKET_BYTES) {
      if (startsVideoKeyframe(bytes, offset)) this.keyframesSeen += 1;
    }
    this.remainder = Buffer.from(bytes.subarray(complete));
    this.ready =
      this.keyframesSeen >= this.keyframes ||
      (this.keyframesSeen > 0 &&
        this.clock.now() - this.startedAt >= this.holdLimitMs);
    return this.ready;
  }
}
