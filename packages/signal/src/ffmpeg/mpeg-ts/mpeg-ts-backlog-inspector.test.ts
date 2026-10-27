import { describe, expect, it } from "vitest";

import { FakeClock } from "../../testing/fake-clock.js";
import { transportPacket } from "../../testing/transport-packet.js";
import { MpegTsBacklogInspector } from "./mpeg-ts-backlog-inspector.js";

const VIDEO_PID = 256;
const AUDIO_PID = 257;
const keyframe = (pid = VIDEO_PID): Buffer =>
  transportPacket({ pid, keyframe: true });
const frame = (): Buffer => transportPacket({ pid: VIDEO_PID });

describe("MpegTsBacklogInspector", () => {
  it("stays unready until the backlog's video keyframes are written", () => {
    const inspector = new MpegTsBacklogInspector(3, new FakeClock(), 10_000);

    expect(inspector.observe(Buffer.concat([keyframe(), frame()]))).toBe(false);
    // Audio frames carry the same random-access flag, but are not keyframes.
    expect(inspector.observe(keyframe(AUDIO_PID))).toBe(false);
    expect(inspector.observe(Buffer.concat([keyframe(), frame()]))).toBe(false);
    expect(inspector.observe(keyframe())).toBe(true);
  });

  it("counts a keyframe split across chunks once it is whole", () => {
    const inspector = new MpegTsBacklogInspector(2, new FakeClock(), 10_000);
    const output = Buffer.concat([keyframe(), keyframe()]);

    expect(inspector.observe(output.subarray(0, 300))).toBe(false);
    expect(inspector.observe(output.subarray(300))).toBe(true);
  });

  it("gives up holding at the limit once a keyframe exists", () => {
    const clock = new FakeClock();
    const inspector = new MpegTsBacklogInspector(10, clock, 10_000);

    clock.advanceBy(10_000);
    // Nothing joinable yet, so the limit alone never makes it ready.
    expect(inspector.observe(frame())).toBe(false);
    expect(inspector.observe(keyframe())).toBe(true);
    expect(inspector.observe(Buffer.alloc(0))).toBe(true);
  });
});
