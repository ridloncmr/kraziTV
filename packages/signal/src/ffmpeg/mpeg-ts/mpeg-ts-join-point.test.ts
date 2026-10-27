import { describe, expect, it } from "vitest";

import { transportPacket } from "../../testing/transport-packet.js";
import { findMpegTsJoinPoint } from "./mpeg-ts-join-point.js";

const VIDEO_PID = 256;
const AUDIO_PID = 257;
const packet = (pid: number): Buffer => transportPacket({ pid });
const keyframe = (pid = VIDEO_PID): Buffer =>
  transportPacket({ pid, keyframe: true });

/** One second of signal as FFmpeg writes it: PAT, PMT, keyframe, then frames. */
const gop = (): Buffer =>
  Buffer.concat([
    packet(0),
    packet(4096),
    keyframe(),
    packet(VIDEO_PID),
    keyframe(AUDIO_PID),
  ]);
const GOP_BYTES = 188 * 5;

describe("findMpegTsJoinPoint", () => {
  it("joins at the PAT before a keyframe, past a partial leading packet", () => {
    const retained = Buffer.concat([Buffer.from([1, 2]), packet(256), gop()]);

    expect(findMpegTsJoinPoint(retained)).toBe(2 + 188);
  });

  it("replays about the join backlog: ten keyframes behind the newest output", () => {
    const retained = Buffer.concat(Array.from({ length: 12 }, gop));

    expect(findMpegTsJoinPoint(retained)).toBe(GOP_BYTES * 2);
  });

  it("replays from the oldest keyframe while less than the backlog is retained", () => {
    const retained = Buffer.concat([
      packet(0),
      packet(VIDEO_PID),
      gop(),
      gop(),
      gop(),
    ]);

    expect(findMpegTsJoinPoint(retained)).toBe(188 * 2);
  });

  it("never joins at a PAT whose next keyframe is only audio", () => {
    const retained = Buffer.concat([
      packet(0),
      packet(4096),
      keyframe(AUDIO_PID),
      packet(VIDEO_PID),
      packet(VIDEO_PID),
    ]);

    expect(findMpegTsJoinPoint(retained)).toBeUndefined();
  });

  it("realigns after a corrupt sync byte and keeps later join points", () => {
    const corrupt = packet(VIDEO_PID);
    corrupt[0] = 0;
    const retained = Buffer.concat([gop(), corrupt, gop()]);

    expect(findMpegTsJoinPoint(retained)).toBe(0);
    expect(findMpegTsJoinPoint(retained.subarray(GOP_BYTES))).toBe(188);
  });
});
