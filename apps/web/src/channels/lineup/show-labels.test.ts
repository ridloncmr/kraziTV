import { describe, expect, it } from "vitest";
import {
  joinShowNames,
  marathonLabel,
  perSittingLabel,
} from "./show-labels.js";

describe("show labels", () => {
  it.each([
    [{ kind: "programs", count: 1 } as const, "1 program"],
    [{ kind: "programs", count: 3 } as const, "3 programs"],
    [{ kind: "airtime", minutes: 30 } as const, "~30 min"],
    [{ kind: "airtime", minutes: 60 } as const, "~1 hr"],
    [{ kind: "airtime", minutes: 150 } as const, "~2 hrs 30 min"],
    [
      { kind: "airtime_range", minMinutes: 45, maxMinutes: 90 } as const,
      "45 min to 1 hr 30 min",
    ],
  ])("words per sitting %o as %s", (stretch, label) => {
    expect(perSittingLabel(stretch)).toBe(label);
  });

  it.each([
    [null, "—"],
    [{ kind: "programs", count: 6 } as const, "up to 6 programs"],
    [{ kind: "airtime", minutes: 180 } as const, "up to 3 hrs"],
    [
      { kind: "airtime_range", minMinutes: 120, maxMinutes: 240 } as const,
      "up to 4 hrs",
    ],
  ])("words marathon length %o as %s", (stretch, label) => {
    expect(marathonLabel(stretch)).toBe(label);
  });

  it.each([
    [["Seinfeld"], "Seinfeld"],
    [["The Office", "Parks"], "The Office + Parks"],
    [["The Office", "Parks", "Cheers"], "The Office + Parks + 1 more"],
    [["A", "B", "C", "D"], "A + B + 2 more"],
  ])("joins member names %o as %s", (names, label) => {
    expect(joinShowNames(names)).toBe(label);
  });
});
