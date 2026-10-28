import { describe, expect, it } from "vitest";

import { transportPacket } from "../../testing/transport-packet.js";
import { VIDEO_PID } from "./mpeg-ts-packet-run.js";
import { MpegTsRejoinGate } from "./mpeg-ts-rejoin-gate.js";

const pat = () => transportPacket({ pid: 0, fill: 1 });
const keyframe = () => transportPacket({ pid: VIDEO_PID, keyframe: true });
const frame = (fill: number) => transportPacket({ pid: VIDEO_PID, fill });

describe("MpegTsRejoinGate", () => {
  it("hands over from the PAT before the first keyframe, and nothing before it", () => {
    const handed: Buffer[] = [];
    const gate = new MpegTsRejoinGate((packets) => handed.push(packets));

    gate.write(Buffer.concat([frame(2), pat(), frame(3)]));
    expect(handed).toEqual([]);
    gate.write(Buffer.concat([keyframe(), frame(4)]));

    expect(handed).toEqual([
      Buffer.concat([pat(), frame(3), keyframe(), frame(4)]),
    ]);
  });

  it("waits for a PAT before any keyframe counts", () => {
    const handed: Buffer[] = [];
    const gate = new MpegTsRejoinGate((packets) => handed.push(packets));

    gate.write(Buffer.concat([keyframe(), frame(2)]));
    expect(handed).toEqual([]);
    gate.write(Buffer.concat([pat(), keyframe()]));

    expect(handed).toEqual([Buffer.concat([pat(), keyframe()])]);
  });

  it("starts from the newest PAT and hands over only once", () => {
    const handed: Buffer[] = [];
    const gate = new MpegTsRejoinGate((packets) => handed.push(packets));

    gate.write(Buffer.concat([pat(), frame(2), pat(), keyframe()]));
    gate.write(Buffer.concat([pat(), keyframe()]));

    expect(handed).toEqual([Buffer.concat([pat(), keyframe()])]);
  });
});
