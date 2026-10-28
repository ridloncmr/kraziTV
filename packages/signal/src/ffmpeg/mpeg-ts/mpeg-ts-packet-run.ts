/** Every MPEG-TS transport packet is exactly this many bytes. */
export const MPEG_TS_PACKET_BYTES = 188;

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

/** Extracts the MPEG-TS PID while masking transport-error and payload flags. */
export function packetPid(buffer: Buffer, offset: number): number {
  return ((buffer[offset + 1] ?? 0) & 0x1f) * 256 + (buffer[offset + 2] ?? 0);
}

/**
 * Reports whether the packet at `offset` begins a PES packet: its payload
 * unit starts with the PES start code. Program tables also set the
 * unit-start flag, but start with a pointer field instead.
 */
export function startsPesPacket(buffer: Buffer, offset: number): boolean {
  if (((buffer[offset + 1] ?? 0) & 0x40) === 0) return false;
  const adaptation = ((buffer[offset + 3] ?? 0) >> 4) & 0x3;
  if ((adaptation & 0x1) === 0) return false;
  const payload =
    offset + 4 + (adaptation === 0x3 ? 1 + (buffer[offset + 4] ?? 0) : 0);
  return (
    buffer[payload] === 0x00 &&
    buffer[payload + 1] === 0x00 &&
    buffer[payload + 2] === 0x01
  );
}

/** The PID of the program association table, which starts every clean entry point. */
export const PAT_PID = 0;

/** The PID the packager maps every item's video to, in every FFmpeg process. */
export const VIDEO_PID = 256;

/**
 * Reports whether the packet at `offset` starts a video keyframe: a video
 * PES start whose adaptation field sets the random-access indicator, as
 * FFmpeg's muxer does for keyframes. Audio frames set it too, so only the
 * video PID counts.
 */
export function startsVideoKeyframe(buffer: Buffer, offset: number): boolean {
  if (packetPid(buffer, offset) !== VIDEO_PID) return false;
  if (((buffer[offset + 1] ?? 0) & 0x40) === 0) return false;
  const adaptation = ((buffer[offset + 3] ?? 0) >> 4) & 0x3;
  if ((adaptation & 0x2) === 0 || (buffer[offset + 4] ?? 0) === 0) {
    return false;
  }
  return ((buffer[offset + 5] ?? 0) & 0x40) !== 0;
}

/**
 * Finds a PES packet's PTS and DTS fields when the packet at `offset` starts
 * one with an optional header carrying them inside this transport packet.
 */
export function pesTimestampFields(
  buffer: Buffer,
  offset: number,
): { ptsAt: number; dtsAt: number | undefined } | undefined {
  if (!startsPesPacket(buffer, offset)) return undefined;
  const adaptation = ((buffer[offset + 3] ?? 0) >> 4) & 0x3;
  const pes =
    offset + 4 + (adaptation === 0x3 ? 1 + (buffer[offset + 4] ?? 0) : 0);
  const end = offset + MPEG_TS_PACKET_BYTES;
  if (pes + 9 > end || ((buffer[pes + 6] ?? 0) & 0xc0) !== 0x80) {
    return undefined;
  }
  const flags = (buffer[pes + 7] ?? 0) >> 6;
  if (flags === 0x2 && pes + 14 <= end) {
    return { ptsAt: pes + 9, dtsAt: undefined };
  }
  if (flags === 0x3 && pes + 19 <= end) {
    return { ptsAt: pes + 9, dtsAt: pes + 14 };
  }
  return undefined;
}

/** Reads a PES timestamp's 33 bits from its five bytes, skipping marker bits. */
export function readTimestamp(buffer: Buffer, at: number): number {
  const high = ((buffer[at] ?? 0) >> 1) & 0x7;
  const middle = ((buffer[at + 1] ?? 0) << 7) | ((buffer[at + 2] ?? 0) >> 1);
  const low = ((buffer[at + 3] ?? 0) << 7) | ((buffer[at + 4] ?? 0) >> 1);
  return high * 2 ** 30 + middle * 2 ** 15 + low;
}

/** Writes a PES timestamp's 33 bits, keeping its prefix and setting its marker bits. */
export function writeTimestamp(
  buffer: Buffer,
  at: number,
  value: number,
): void {
  const high = Math.floor(value / 2 ** 30) & 0x7;
  const middle = Math.floor(value / 2 ** 15) & 0x7fff;
  const low = value & 0x7fff;
  buffer[at] = ((buffer[at] ?? 0) & 0xf0) | (high << 1) | 0x1;
  buffer[at + 1] = middle >> 7;
  buffer[at + 2] = ((middle & 0x7f) << 1) | 0x1;
  buffer[at + 3] = low >> 7;
  buffer[at + 4] = ((low & 0x7f) << 1) | 0x1;
}

/** Finds the PCR in the packet's adaptation field, when it carries one. */
export function pcrBaseOffset(
  buffer: Buffer,
  offset: number,
): number | undefined {
  const adaptation = ((buffer[offset + 3] ?? 0) >> 4) & 0x3;
  if ((adaptation & 0x2) === 0 || (buffer[offset + 4] ?? 0) < 7) {
    return undefined;
  }
  return ((buffer[offset + 5] ?? 0) & 0x10) !== 0 ? offset + 6 : undefined;
}

/** Reads the PCR's 33-bit 90 kHz base; its 27 MHz extension needs no shift. */
export function readPcrBase(buffer: Buffer, at: number): number {
  return (
    (buffer[at] ?? 0) * 2 ** 25 +
    (buffer[at + 1] ?? 0) * 2 ** 17 +
    (buffer[at + 2] ?? 0) * 2 ** 9 +
    (buffer[at + 3] ?? 0) * 2 +
    ((buffer[at + 4] ?? 0) >> 7)
  );
}

/** Writes the PCR base, keeping the reserved bits and extension after it. */
export function writePcrBase(buffer: Buffer, at: number, base: number): void {
  buffer[at] = Math.floor(base / 2 ** 25) & 0xff;
  buffer[at + 1] = Math.floor(base / 2 ** 17) & 0xff;
  buffer[at + 2] = Math.floor(base / 2 ** 9) & 0xff;
  buffer[at + 3] = Math.floor(base / 2) & 0xff;
  buffer[at + 4] = ((base & 0x1) << 7) | ((buffer[at + 4] ?? 0) & 0x7f);
}
