import { afterEach, describe, expect, it } from "vitest";

import { formatXmltvTime } from "./xmltv-time.js";

const hostTimeZone = process.env.TZ;

afterEach(() => {
  if (hostTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = hostTimeZone;
});

describe("formatXmltvTime", () => {
  it("formats UTC seconds with an explicit +0000 offset, truncating milliseconds", () => {
    expect(formatXmltvTime(Date.parse("2026-10-05T12:34:56.999Z"))).toBe(
      "20261005123456 +0000",
    );
  });

  it("ignores the host time zone", () => {
    // Node re-reads TZ on assignment, so local-time getters would shift here.
    process.env.TZ = "Pacific/Kiritimati";

    expect(formatXmltvTime(Date.parse("2026-12-31T23:59:59.000Z"))).toBe(
      "20261231235959 +0000",
    );
  });
});
