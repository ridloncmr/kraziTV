import { JOIN_BACKLOG_MS } from "../join-backlog.js";
import {
  MPEG_TS_PACKET_BYTES,
  packetPid,
  startsAlignedPacketRun,
  startsVideoKeyframe,
} from "./mpeg-ts-packet-run.js";

const PAT_PID = 0;

// The packager's GOP is one second (`-g 30` at 30 fps), so each keyframe back
// from the newest adds about a second of replay.
const JOIN_BACKLOG_KEYFRAMES = JOIN_BACKLOG_MS / 1_000;

/**
 * Finds where a joining viewer's replay starts: the PAT before the video
 * keyframe about the join backlog behind the newest output, or before the
 * oldest retained keyframe when less is retained. Starting at a PAT gives
 * the viewer program tables first; starting at a keyframe means nothing it
 * receives is undecodable, and the backlog fills Plex's buffer at once.
 */
export function findMpegTsJoinPoint(retained: Buffer): number | undefined {
  const joinPoints = keyframeJoinPoints(retained);
  return joinPoints[Math.max(0, joinPoints.length - JOIN_BACKLOG_KEYFRAMES)];
}

/**
 * Lists, oldest first, the newest PAT before each complete video keyframe
 * packet. Retention drops its oldest bytes mid-packet, so the walk first
 * aligns on a run of sync bytes, then realigns wherever one is missing.
 */
function keyframeJoinPoints(retained: Buffer): number[] {
  const joinPoints: number[] = [];
  let lastPat: number | undefined;
  let offset = nextAlignedOffset(retained, 0);
  while (offset + MPEG_TS_PACKET_BYTES <= retained.byteLength) {
    if (retained[offset] !== 0x47) {
      offset = nextAlignedOffset(retained, offset + 1);
      continue;
    }
    if (packetPid(retained, offset) === PAT_PID) lastPat = offset;
    else if (lastPat !== undefined && startsVideoKeyframe(retained, offset)) {
      joinPoints.push(lastPat);
    }
    offset += MPEG_TS_PACKET_BYTES;
  }
  return joinPoints;
}

/** Finds the first offset from `from` that starts a run of aligned packets. */
function nextAlignedOffset(retained: Buffer, from: number): number {
  for (let offset = from; offset < retained.byteLength; offset += 1) {
    if (startsAlignedPacketRun(retained, offset)) return offset;
  }
  return retained.byteLength;
}
