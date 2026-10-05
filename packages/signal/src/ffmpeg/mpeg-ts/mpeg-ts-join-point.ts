import {
  ALIGNED_PACKET_RUN,
  MPEG_TS_PACKET_BYTES,
  startsAlignedPacketRun,
} from "./mpeg-ts-packet-run.js";

const PAT_PID = 0;

/**
 * Finds the newest PAT-aligned late-join point backed by complete packets, so
 * a joining viewer gets program tables first and no stale replay.
 */
export function findMpegTsJoinPoint(retained: Buffer): number | undefined {
  for (
    let offset =
      retained.byteLength - MPEG_TS_PACKET_BYTES * ALIGNED_PACKET_RUN;
    offset >= 0;
    offset -= 1
  ) {
    if (
      startsAlignedPacketRun(retained, offset) &&
      packetPid(retained, offset) === PAT_PID
    ) {
      return offset;
    }
  }
  return undefined;
}

/** Extracts the MPEG-TS PID while masking transport-error and payload flags. */
function packetPid(buffer: Buffer, offset: number): number {
  return ((buffer[offset + 1] ?? 0) & 0x1f) * 256 + (buffer[offset + 2] ?? 0);
}
