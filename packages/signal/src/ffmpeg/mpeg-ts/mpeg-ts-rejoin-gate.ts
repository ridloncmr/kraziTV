import type { PacketSink } from "../contracts.js";
import {
  MPEG_TS_PACKET_BYTES,
  PAT_PID,
  packetPid,
  startsVideoKeyframe,
} from "./mpeg-ts-packet-run.js";

/**
 * Takes a set-aside item's packets and drops them until a clean entry point:
 * a PAT, then a video keyframe. It then hands everything from that PAT on to
 * `onRejoin`, once, so a stalled item returns to the broadcast on program
 * tables and a whole picture rather than mid-frame (ADR 0020). Only packets
 * since the newest PAT are kept, and FFmpeg repeats the PAT many times a
 * second, so the gate holds little.
 */
export class MpegTsRejoinGate implements PacketSink {
  private fromPat: Buffer[] = [];
  private rejoined = false;

  /** Takes who to hand the entry point to. */
  constructor(private readonly onRejoin: (packets: Buffer) => void) {}

  /** Watches each packet for the entry point, ignoring all once handed over. */
  write(packets: Buffer): void {
    for (
      let offset = 0;
      !this.rejoined && offset < packets.byteLength;
      offset += MPEG_TS_PACKET_BYTES
    ) {
      if (packetPid(packets, offset) === PAT_PID) {
        this.fromPat = [];
      } else if (this.fromPat.length === 0) {
        continue;
      } else if (startsVideoKeyframe(packets, offset)) {
        this.rejoined = true;
        this.onRejoin(
          Buffer.concat([...this.fromPat, packets.subarray(offset)]),
        );
        return;
      }
      this.fromPat.push(
        packets.subarray(offset, offset + MPEG_TS_PACKET_BYTES),
      );
    }
  }
}
