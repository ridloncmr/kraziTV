import { describe, expect, it } from "vitest";
import {
  marathonLabel,
  perSittingLabel,
  stretchProblemWords,
} from "./stretch-words.js";

describe("stretch words", () => {
  it.each([
    [{ kind: "programs", count: 1 } as const, null, "1 program"],
    [{ kind: "programs", count: 3 } as const, null, "3 programs"],
    [{ kind: "programs", count: 1 } as const, "movies" as const, "1 movie"],
    [{ kind: "programs", count: 2 } as const, "movies" as const, "2 movies"],
    [{ kind: "programs", count: 1 } as const, "episodes" as const, "1 episode"],
    [
      { kind: "programs", count: 4 } as const,
      "episodes" as const,
      "4 episodes",
    ],
    [{ kind: "airtime", minutes: 30 } as const, "episodes" as const, "~30 min"],
    [{ kind: "airtime", minutes: 60 } as const, null, "~1 hr"],
    [{ kind: "airtime", minutes: 150 } as const, null, "~2 hrs 30 min"],
    [
      { kind: "airtime_range", minMinutes: 45, maxMinutes: 90 } as const,
      null,
      "45 min to 1 hr 30 min",
    ],
  ])("words per sitting %o for %s as %s", (stretch, kind, label) => {
    expect(perSittingLabel(stretch, kind)).toBe(label);
  });

  it.each([
    [null, null, ""],
    [{ kind: "programs", count: 6 } as const, null, "up to 6 programs"],
    [
      { kind: "programs", count: 6 } as const,
      "episodes" as const,
      "up to 6 episodes",
    ],
    [
      { kind: "airtime", minutes: 180 } as const,
      "movies" as const,
      "up to 3 hrs",
    ],
    [
      { kind: "airtime_range", minMinutes: 120, maxMinutes: 240 } as const,
      null,
      "up to 4 hrs",
    ],
  ])("words marathon length %o for %s as %s", (stretch, kind, label) => {
    expect(marathonLabel(stretch, kind)).toBe(label);
  });
});

describe("stretch problem words", () => {
  it.each([
    ["shorter", "Make the marathon longer than Plays at a time."],
    [
      "unit",
      "Set the marathon in the same unit as Plays at a time: programs with programs, minutes with minutes.",
    ],
    [
      "shape",
      "Use whole numbers of 1 or more, and make At most minutes no less than At least minutes.",
    ],
    // A kind added later, or none, is a value the fields refuse.
    [
      "longer",
      "Use whole numbers of 1 or more, and make At most minutes no less than At least minutes.",
    ],
    [
      undefined,
      "Use whole numbers of 1 or more, and make At most minutes no less than At least minutes.",
    ],
  ])("says what to change for a %s problem", (kind, words) => {
    expect(stretchProblemWords(kind)).toBe(words);
  });
});
