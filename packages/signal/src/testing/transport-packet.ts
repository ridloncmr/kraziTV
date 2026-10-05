import { MPEG_TS_PACKET_BYTES } from "../ffmpeg/mpeg-ts/mpeg-ts-packet-run.js";

/**
 * Builds one MPEG-TS packet with its sync byte set. `fill` makes packets
 * distinguishable by payload; `pid`, when given, overwrites the PID field so
 * join-point tests can place PATs.
 */
export function transportPacket(
  options: { pid?: number; fill?: number } = {},
): Buffer {
  const packet = Buffer.alloc(MPEG_TS_PACKET_BYTES, options.fill ?? 0);
  packet[0] = 0x47;
  if (options.pid !== undefined) {
    packet[1] = (options.pid >> 8) & 0x1f;
    packet[2] = options.pid & 0xff;
  }
  return packet;
}
