import type { OutputReadinessInspector } from "../contracts.js";
import { MPEG_TS_PACKET_BYTES } from "./mpeg-ts-packet-forwarder.js";
import {
  ALIGNED_PACKET_RUN,
  startsAlignedPacketRun,
} from "./mpeg-ts-packet-run.js";

const INSPECTION_WINDOW_BYTES =
  MPEG_TS_PACKET_BYTES * ALIGNED_PACKET_RUN + MPEG_TS_PACKET_BYTES - 1;

/** Detects a provisional bounded run of complete aligned MPEG-TS packets. */
export class MpegTsReadinessInspector implements OutputReadinessInspector {
  private pending = Buffer.alloc(0);
  private ready = false;

  /** Returns true permanently after observing three complete aligned packets. */
  observe(chunk: Uint8Array): boolean {
    if (this.ready) return true;
    if (chunk.byteLength === 0) return false;

    const combined = Buffer.concat([this.pending, Buffer.from(chunk)]);
    this.ready = hasCompleteAlignedPackets(combined);
    if (!this.ready) {
      this.pending = Buffer.from(combined.subarray(-INSPECTION_WINDOW_BYTES));
    }

    return this.ready;
  }
}

/** Finds complete packets without assuming chunks begin on an MPEG-TS boundary. */
function hasCompleteAlignedPackets(buffer: Buffer): boolean {
  for (let offset = 0; offset < buffer.byteLength; offset += 1) {
    if (startsAlignedPacketRun(buffer, offset)) return true;
  }
  return false;
}
