import type { PassThrough, Readable } from "node:stream";

import {
  MPEG_TS_PACKET_BYTES,
  packetPid,
  startsPesPacket,
} from "./mpeg-ts-packet-run.js";

/**
 * Forwards one FFmpeg process's output as whole transport packets, holding
 * back each stream's open PES packet until that stream's next one starts.
 * FFmpeg writes video PES packets without a length, so only the next start
 * proves a frame complete; holding it lets a cut mid-media (ADR 0015) drop
 * an unfinished frame instead of splicing a corrupt one into the signal.
 */
export class MpegTsPacketForwarder {
  private remainder = Buffer.alloc(0);
  /** Whole packets not yet written, in arrival order. */
  private held: Buffer[] = [];
  /** Per PES stream, the index in `held` where its open PES packet starts. */
  private readonly openPes = new Map<number, number>();

  /** Starts forwarding immediately so no early FFmpeg bytes are missed. */
  constructor(
    private readonly source: Readable,
    private readonly destination: PassThrough,
  ) {
    source.on("data", this.forward);
    source.on("end", this.flush);
  }

  /**
   * Detaches synchronously, writing what finished and dropping the old FFmpeg
   * process's partial packet and every stream's unfinished PES packet.
   */
  detach(): void {
    this.source.off("data", this.forward);
    this.source.off("end", this.flush);
    const finished = this.held.filter((packet, index) => {
      const openAt = this.openPes.get(packetPid(packet, 0));
      return openAt === undefined || index < openAt;
    });
    this.write(finished);
    this.reset();
  }

  /** Holds complete 188-byte units and writes those every stream has finished. */
  private readonly forward = (chunk: Buffer | Uint8Array | string): void => {
    const bytes = Buffer.from(chunk);
    const available =
      this.remainder.byteLength === 0
        ? bytes
        : Buffer.concat([this.remainder, bytes]);
    const completeBytes =
      Math.floor(available.byteLength / MPEG_TS_PACKET_BYTES) *
      MPEG_TS_PACKET_BYTES;
    for (
      let offset = 0;
      offset < completeBytes;
      offset += MPEG_TS_PACKET_BYTES
    ) {
      const packet = available.subarray(offset, offset + MPEG_TS_PACKET_BYTES);
      if (startsPesPacket(packet, 0)) {
        this.openPes.set(packetPid(packet, 0), this.held.length);
      }
      this.held.push(packet);
    }
    this.remainder = Buffer.from(available.subarray(completeBytes));

    const safe = Math.min(this.held.length, ...this.openPes.values());
    this.write(this.held.slice(0, safe));
    this.held = this.held.slice(safe);
    for (const [pid, index] of this.openPes)
      this.openPes.set(pid, index - safe);
  };

  /** Writes every held packet once the process ends, since nothing is open. */
  private readonly flush = (): void => {
    this.write(this.held);
    this.reset();
  };

  /** Writes packets as one chunk, without letting backpressure stall FFmpeg. */
  private write(packets: readonly Buffer[]): void {
    if (packets.length > 0) this.destination.write(Buffer.concat(packets));
  }

  /** Forgets everything held, so nothing of this process escapes later. */
  private reset(): void {
    this.remainder = Buffer.alloc(0);
    this.held = [];
    this.openPes.clear();
  }
}
