import { describe, expect, it } from "vitest";

import { transportPacket } from "../../testing/transport-packet.js";
import { MpegTsReadinessInspector } from "./mpeg-ts-readiness-inspector.js";

const packet = (fill: number): Buffer => transportPacket({ fill });

describe("MpegTsReadinessInspector", () => {
  it("does not accept random bytes or a lone sync byte", () => {
    const inspector = new MpegTsReadinessInspector();

    expect(inspector.observe(Buffer.alloc(563))).toBe(false);
    expect(inspector.observe(Buffer.from([0x47]))).toBe(false);
  });

  it("requires three complete aligned MPEG-TS packets", () => {
    const inspector = new MpegTsReadinessInspector();
    const output = Buffer.concat([packet(1), packet(2), packet(3)]);

    expect(inspector.observe(output.subarray(0, output.byteLength - 1))).toBe(
      false,
    );
    expect(inspector.observe(output.subarray(-1))).toBe(true);
  });

  it("finds packet alignment after unrelated leading bytes", () => {
    const inspector = new MpegTsReadinessInspector();
    const output = Buffer.concat([
      Buffer.from([1, 2, 3, 4]),
      packet(1),
      packet(2),
      packet(3),
    ]);

    expect(inspector.observe(output)).toBe(true);
  });
});
