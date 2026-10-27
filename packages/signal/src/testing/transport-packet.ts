import { MPEG_TS_PACKET_BYTES } from "../ffmpeg/mpeg-ts/mpeg-ts-packet-run.js";

/**
 * Builds one MPEG-TS packet with its sync byte set. `fill` makes packets
 * distinguishable by payload; `pid`, when given, overwrites the PID field so
 * join-point tests can place PATs; `pesStart` makes the packet begin a PES
 * packet, so forwarding tests can mark where each frame starts; `keyframe`
 * makes it begin one with the random-access indicator FFmpeg sets on
 * keyframes, so join-point tests can place them.
 */
export function transportPacket(
  options: {
    pid?: number;
    fill?: number;
    pesStart?: boolean;
    keyframe?: boolean;
  } = {},
): Buffer {
  const packet = Buffer.alloc(MPEG_TS_PACKET_BYTES, options.fill ?? 0);
  packet[0] = 0x47;
  if (options.pid !== undefined) {
    packet[1] = (options.pid >> 8) & 0x1f;
    packet[2] = options.pid & 0xff;
  }
  if (options.pesStart === true) {
    packet[1] = (packet[1] ?? 0) | 0x40;
    // Payload only, then the PES start code.
    packet[3] = 0x10;
    packet.set([0x00, 0x00, 0x01], 4);
  }
  if (options.keyframe === true) {
    packet[1] = (packet[1] ?? 0) | 0x40;
    // Adaptation field with the random-access flag, then the PES start code.
    packet[3] = 0x30;
    packet.set([0x01, 0x40, 0x00, 0x00, 0x01], 4);
  }
  return packet;
}
