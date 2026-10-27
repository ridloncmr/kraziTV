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
