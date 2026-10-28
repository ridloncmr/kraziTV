import {
  MPEG_TS_PACKET_BYTES,
  writePcrBase,
  writeTimestamp,
} from "../ffmpeg/mpeg-ts/mpeg-ts-packet-run.js";

/**
 * Builds one MPEG-TS packet with its sync byte set. `fill` makes packets
 * distinguishable by payload; `pid`, when given, overwrites the PID field so
 * join-point tests can place PATs; `pesStart` makes the packet begin a PES
 * packet, so forwarding tests can mark where each frame starts; `keyframe`
 * makes it begin one with the random-access indicator FFmpeg sets on
 * keyframes, so join-point tests can place them. `pts` and `dts` give a
 * started PES packet those 90 kHz timestamps, and `pcr` puts a PCR base in
 * the adaptation field, as FFmpeg writes them, so timestamp tests can splice
 * processes.
 */
export function transportPacket(
  options: {
    pid?: number;
    fill?: number;
    pesStart?: boolean;
    keyframe?: boolean;
    pts?: number;
    dts?: number;
    pcr?: number;
  } = {},
): Buffer {
  const packet = Buffer.alloc(MPEG_TS_PACKET_BYTES, options.fill ?? 0);
  packet[0] = 0x47;
  if (options.pid !== undefined) {
    packet[1] = (options.pid >> 8) & 0x1f;
    packet[2] = options.pid & 0xff;
  }
  const startsPes =
    options.pesStart === true ||
    options.keyframe === true ||
    options.pts !== undefined;
  const flags =
    (options.keyframe === true ? 0x40 : 0) |
    (options.pcr === undefined ? 0 : 0x10);
  let payload = 4;
  if (flags === 0) {
    // Payload only; a plain packet keeps `fill` in its header byte.
    if (startsPes) packet[3] = 0x10;
  } else {
    // Adaptation field with its flags, and a PCR when given, then payload.
    const length = options.pcr === undefined ? 1 : 7;
    packet[3] = 0x30;
    packet[4] = length;
    packet[5] = flags;
    if (options.pcr !== undefined) {
      packet.set([0, 0, 0, 0, 0x7e, 0], 6);
      writePcrBase(packet, 6, options.pcr);
    }
    payload = 5 + length;
  }
  if (!startsPes) return packet;
  packet[1] = (packet[1] ?? 0) | 0x40;
  packet.set([0x00, 0x00, 0x01], payload);
  if (options.pts !== undefined) {
    const hasDts = options.dts !== undefined;
    // Video stream ID, unbounded length, then the optional header's flags.
    packet.set(
      [0xe0, 0, 0, 0x80, hasDts ? 0xc0 : 0x80, hasDts ? 10 : 5],
      payload + 3,
    );
    packet[payload + 9] = hasDts ? 0x30 : 0x20;
    writeTimestamp(packet, payload + 9, options.pts);
    if (options.dts !== undefined) {
      packet[payload + 14] = 0x10;
      writeTimestamp(packet, payload + 14, options.dts);
    }
  }
  return packet;
}
