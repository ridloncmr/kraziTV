import { pino } from "pino";
import { describe, expect, it } from "vitest";

import { captureLogLines } from "../../testing/captured-log-lines.js";
import { toSignalLogger } from "./signal-log.js";

// A debug-level pino whose lines the test reads back as fields.
function capturedPino() {
  const { lines, stream } = captureLogLines();
  return { lines, log: pino({ level: "debug" }, stream) };
}

describe("toSignalLogger", () => {
  it.each([
    ["debug", 20],
    ["info", 30],
    ["warn", 40],
    ["error", 50],
  ] as const)(
    "writes %s with the message as msg and context as fields",
    (method, level) => {
      const { lines, log } = capturedPino();

      toSignalLogger(log)[method]("FFmpeg exited", { channelId: "c1" });

      expect(lines).toEqual([
        expect.objectContaining({
          level,
          msg: "FFmpeg exited",
          channelId: "c1",
        }),
      ]);
    },
  );

  it("logs a message without context", () => {
    const { lines, log } = capturedPino();

    toSignalLogger(log).info("worker ready");

    expect(lines).toEqual([
      expect.objectContaining({ level: 30, msg: "worker ready" }),
    ]);
  });
});
