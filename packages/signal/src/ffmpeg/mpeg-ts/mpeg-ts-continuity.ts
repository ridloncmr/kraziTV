import type { PassThrough } from "node:stream";

import type { PacketSink } from "../contracts.js";
import { MPEG_TS_PACKET_BYTES, packetPid } from "./mpeg-ts-packet-run.js";

/** The PID of null packets, whose continuity counter carries no meaning. */
const NULL_PID = 0x1fff;

/**
 * Writes transport packets to a session's output with each stream's
 * continuity counter continued across every FFmpeg process of the session.
 * Every FFmpeg process counts each stream from zero, so the counters are
 * rewritten here, at the one point packets reach the output, whether they
 * arrive live or were held for a prepared item (ADR 0016): a decoder sees
 * one continuous stream and never marks the frame before a boundary corrupt.
 */
export class MpegTsContinuity implements PacketSink {
  /** Per PID, the next continuity counter the output carries. */
  private readonly counters = new Map<number, number>();

  /** Binds the counters to the one output they continue. */
  constructor(private readonly destination: PassThrough) {}

  /**
   * Writes packets as one chunk, without letting backpressure stall FFmpeg,
   * each carrying the next counter for its PID. A packet without payload
   * repeats the last counter, as the standard requires; null packets, and
   * the reserved field value no real packet carries, keep theirs.
   */
  write(packets: Buffer): void {
    if (packets.byteLength === 0) return;
    for (
      let offset = 0;
      offset < packets.byteLength;
      offset += MPEG_TS_PACKET_BYTES
    ) {
      const pid = packetPid(packets, offset);
      const header = packets[offset + 3] ?? 0;
      if (pid === NULL_PID || (header & 0x30) === 0) continue;
      const next = this.counters.get(pid) ?? header & 0x0f;
      const hasPayload = (header & 0x10) !== 0;
      const counter = hasPayload ? next : (next + 15) & 0x0f;
      packets[offset + 3] = (header & 0xf0) | counter;
      if (hasPayload) this.counters.set(pid, (next + 1) & 0x0f);
    }
    this.destination.write(packets);
  }
}
