import { describe, expect, it } from "vitest";

import { MediaProbeError } from "./media-probe-error.js";

describe("MediaProbeError", () => {
  it("keeps the code and message for ordinary failures", () => {
    const error = new MediaProbeError("timed_out", "ffprobe timed out");
    expect(error.code).toBe("timed_out");
    expect(error.message).toBe("ffprobe timed out");
    expect(error.name).toBe("MediaProbeError");
  });

  it("strips terminal escape sequences and control characters", () => {
    const error = new MediaProbeError(
      "exited_with_error",
      "bad \u001b[1;31mred\u001b[0m \u001b]0;title\u0007file\u0000\r\nnext",
    );
    expect(error.message).toBe("bad red file next");
  });

  it("truncates messages so any detail is safe to store", () => {
    const error = new MediaProbeError("invalid_metadata", "d".repeat(10_000));
    expect(error.message).toHaveLength(300);
    expect(error.message.endsWith("…")).toBe(true);
  });
});
