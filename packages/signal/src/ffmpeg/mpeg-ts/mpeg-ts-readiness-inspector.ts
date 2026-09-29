const MPEG_TS_PACKET_BYTES = 188;
const REQUIRED_ALIGNED_PACKETS = 3;
const INSPECTION_WINDOW_BYTES =
  MPEG_TS_PACKET_BYTES * REQUIRED_ALIGNED_PACKETS + MPEG_TS_PACKET_BYTES - 1;

export interface OutputReadinessInspector {
  /** Reports whether the output observed so far satisfies session readiness. */
  observe(chunk: Uint8Array): boolean;
}

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
  const requiredBytes = MPEG_TS_PACKET_BYTES * REQUIRED_ALIGNED_PACKETS;
  for (
    let offset = 0;
    offset + requiredBytes <= buffer.byteLength;
    offset += 1
  ) {
    if (
      buffer[offset] === 0x47 &&
      buffer[offset + MPEG_TS_PACKET_BYTES] === 0x47 &&
      buffer[offset + MPEG_TS_PACKET_BYTES * 2] === 0x47
    ) {
      return true;
    }
  }
  return false;
}
