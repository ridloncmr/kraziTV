import { MPEG_TS_PACKET_BYTES } from "./mpeg-ts-packet-forwarder.js";

/** How many consecutive sync bytes prove an offset is packet-aligned. */
export const ALIGNED_PACKET_RUN = 3;

/**
 * Reports whether three complete packets start at `offset`, because one sync
 * byte alone also occurs inside payloads.
 */
export function startsAlignedPacketRun(
  buffer: Buffer,
  offset: number,
): boolean {
  if (offset + MPEG_TS_PACKET_BYTES * ALIGNED_PACKET_RUN > buffer.byteLength) {
    return false;
  }
  for (let packet = 0; packet < ALIGNED_PACKET_RUN; packet += 1) {
    if (buffer[offset + MPEG_TS_PACKET_BYTES * packet] !== 0x47) return false;
  }
  return true;
}
