import { describe, expect, it } from "vitest";

import { transportPacket } from "../../testing/transport-packet.js";
import { findMpegTsJoinPoint } from "./mpeg-ts-join-point.js";

const packet = (pid: number): Buffer => transportPacket({ pid });

describe("findMpegTsJoinPoint", () => {
  it("returns an aligned PAT packet backed by further synchronized packets", () => {
    const retained = Buffer.concat([
      Buffer.from([1, 2]),
      packet(256),
      packet(0),
      packet(100),
      packet(256),
    ]);

    expect(findMpegTsJoinPoint(retained)).toBe(190);
  });

  it("returns the newest valid PAT so late joins do not replay stale output", () => {
    const retained = Buffer.concat([
      packet(0),
      packet(256),
      packet(256),
      packet(0),
      packet(256),
      packet(256),
    ]);

    expect(findMpegTsJoinPoint(retained)).toBe(188 * 3);
  });

  it("returns undefined when no PAT has two complete packets after it", () => {
    const retained = Buffer.concat([packet(256), packet(256), packet(0)]);

    expect(findMpegTsJoinPoint(retained)).toBeUndefined();
  });
});
