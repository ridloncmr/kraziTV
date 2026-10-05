import { describe, expect, it } from "vitest";

import { parseTunerConfig } from "./tuner.js";

describe("parseTunerConfig", () => {
  it("uses a fixed device ID and two tuners by default", () => {
    expect(parseTunerConfig({})).toEqual({
      deviceId: "4B5A5456",
      tunerCount: 2,
    });
  });

  it("reads both settings from the environment, uppercasing the ID", () => {
    expect(
      parseTunerConfig({
        KRAZITV_DEVICE_ID: " 0badf00d ",
        KRAZITV_TUNER_COUNT: "4",
      }),
    ).toEqual({ deviceId: "0BADF00D", tunerCount: 4 });
  });

  it.each(["0BADF00", "0BADF00D1", "0BADF00G", "0x12345"])(
    "rejects KRAZITV_DEVICE_ID=%s",
    (value) => {
      expect(() => parseTunerConfig({ KRAZITV_DEVICE_ID: value })).toThrow(
        `KRAZITV_DEVICE_ID must be 8 hexadecimal digits; received "${value}"`,
      );
    },
  );

  it.each(["0", "65", "two"])("rejects KRAZITV_TUNER_COUNT=%s", (value) => {
    expect(() => parseTunerConfig({ KRAZITV_TUNER_COUNT: value })).toThrow(
      `KRAZITV_TUNER_COUNT must be an integer from 1 through 64; received "${value}"`,
    );
  });
});
