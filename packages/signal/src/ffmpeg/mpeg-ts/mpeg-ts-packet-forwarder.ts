import type { PassThrough, Readable } from "node:stream";

const MPEG_TS_PACKET_BYTES = 188;

/** Buffers one encoder's partial tail so only whole transport packets escape. */
export class MpegTsPacketForwarder {
  private remainder = Buffer.alloc(0);

  /** Starts forwarding immediately so no early encoder bytes are missed. */
  constructor(
    private readonly source: Readable,
    private readonly destination: PassThrough,
  ) {
    source.on("data", this.forward);
  }

  /** Detaches synchronously and drops an incomplete old-encoder packet. */
  detach(): void {
    this.source.off("data", this.forward);
    this.remainder = Buffer.alloc(0);
  }

  /** Emits complete 188-byte units without letting backpressure stall FFmpeg. */
  private readonly forward = (chunk: Buffer | Uint8Array | string): void => {
    const bytes = Buffer.from(chunk);
    const available =
      this.remainder.byteLength === 0
        ? bytes
        : Buffer.concat([this.remainder, bytes]);
    const completeBytes =
      Math.floor(available.byteLength / MPEG_TS_PACKET_BYTES) *
      MPEG_TS_PACKET_BYTES;
    if (completeBytes > 0) {
      this.destination.write(available.subarray(0, completeBytes));
    }
    this.remainder = Buffer.from(available.subarray(completeBytes));
  };
}
