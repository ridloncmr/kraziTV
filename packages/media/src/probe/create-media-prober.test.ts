import { describe, expect, it } from "vitest";

import { createMediaProber } from "./create-media-prober.js";
import { MediaProbeError } from "./media-probe-error.js";

describe("createMediaProber", () => {
  it("reports a missing ffprobe executable as a spawn failure", async () => {
    const prober = createMediaProber({
      ffprobePath: `missing-krazitv-ffprobe-${process.pid}`,
      timeoutMs: 30_000,
    });

    const error = await prober
      .probe("/media/show.mkv")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MediaProbeError);
    expect((error as MediaProbeError).code).toBe("spawn_failed");
  });

  it("validates configuration at construction", () => {
    expect(() =>
      createMediaProber({ ffprobePath: "ffprobe", timeoutMs: 0 }),
    ).toThrow(RangeError);
  });
});
