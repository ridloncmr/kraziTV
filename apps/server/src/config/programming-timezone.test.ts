import { describe, expect, it } from "vitest";

import { recordingLog } from "../testing/recording-log.js";
import { resolveProgrammingTimezone } from "./programming-timezone.js";

describe("resolveProgrammingTimezone", () => {
  it("uses a configured IANA name and says it was configured", () => {
    const log = recordingLog();

    expect(
      resolveProgrammingTimezone(
        { KRAZITV_PROGRAMMING_TIMEZONE: " America/Chicago " },
        log,
        "Europe/Berlin",
      ),
    ).toBe("America/Chicago");
    expect(log.lines).toEqual([
      {
        level: "info",
        fields: {
          programmingTimezone: "America/Chicago",
          source: "configured",
        },
        message: "Using the configured programming timezone",
      },
    ]);
  });

  it("falls back to the host timezone when unset, and says so", () => {
    const log = recordingLog();

    expect(resolveProgrammingTimezone({}, log, "Europe/Berlin")).toBe(
      "Europe/Berlin",
    );
    expect(log.lines).toEqual([
      {
        level: "info",
        fields: { programmingTimezone: "Europe/Berlin", source: "host" },
        message:
          "KRAZITV_PROGRAMMING_TIMEZONE is unset; using the host timezone",
      },
    ]);
  });

  it.each(["UTC", "Etc/UTC"])(
    "warns when unset on a host reporting %s, as containers often do",
    (host) => {
      const log = recordingLog();

      expect(resolveProgrammingTimezone({}, log, host)).toBe(host);
      expect(log.lines).toEqual([
        {
          level: "warn",
          fields: { programmingTimezone: host, source: "host" },
          message:
            "KRAZITV_PROGRAMMING_TIMEZONE is unset and the host reports UTC; set it so calendar rules follow local time",
        },
      ]);
    },
  );

  it("does not warn when UTC is configured explicitly", () => {
    const log = recordingLog();

    expect(
      resolveProgrammingTimezone(
        { KRAZITV_PROGRAMMING_TIMEZONE: "UTC" },
        log,
        "UTC",
      ),
    ).toBe("UTC");
    expect(log.lines.map((entry) => entry.level)).toEqual(["info"]);
  });

  it.each(["Mars/Olympus_Mons", "not a zone", "+05:00", "-0800"])(
    "fails on an invalid name %s with a clear message",
    (value) => {
      expect(() =>
        resolveProgrammingTimezone(
          { KRAZITV_PROGRAMMING_TIMEZONE: value },
          recordingLog(),
          "UTC",
        ),
      ).toThrow(
        `KRAZITV_PROGRAMMING_TIMEZONE must be an IANA timezone name such as America/New_York; received "${value}"`,
      );
    },
  );
});
