import { describe, expect, it } from "vitest";

import { formatLineup } from "./lineup.js";

describe("formatLineup", () => {
  it("maps each channel to exactly the three HDHomeRun lineup fields, in input order", () => {
    // Extra fields stand in for a server channel record passed through whole.
    const channels = [
      { id: "a", enabled: true, number: "2", name: "Two", streamUrl: "u2" },
      { id: "b", enabled: true, number: "10", name: "Ten", streamUrl: "u10" },
      { id: "c", enabled: true, number: "69.1", name: "Sub", streamUrl: "u69" },
    ];

    expect(formatLineup(channels)).toStrictEqual([
      { GuideNumber: "2", GuideName: "Two", URL: "u2" },
      { GuideNumber: "10", GuideName: "Ten", URL: "u10" },
      { GuideNumber: "69.1", GuideName: "Sub", URL: "u69" },
    ]);
  });
});
