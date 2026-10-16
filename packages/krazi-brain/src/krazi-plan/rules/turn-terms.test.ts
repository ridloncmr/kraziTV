import { describe, expect, it } from "vitest";

import {
  collectionAssignment,
  programmingRule,
} from "../../testing/programming-assignments.js";
import { scheduleMedia } from "../../testing/schedule-media.js";
import { turnTerms } from "./turn-terms.js";

const INSTANT = Date.parse("2026-12-04T19:00:00Z");
const EPISODE = scheduleMedia("episode", { durationMs: 30 * 60_000 });
const OFFICE = collectionAssignment("office", "c-office", [EPISODE], {
  ordinary: { kind: "programs", count: 3 },
});
const CHRISTMAS = collectionAssignment("christmas", "c-christmas", [EPISODE], {
  participation: "rule_only",
});
const ASSIGNMENTS = [OFFICE, CHRISTMAS];

describe("turnTerms", () => {
  it("describes a default turn's context, eligibility, and settings", () => {
    expect(turnTerms([], ASSIGNMENTS, INSTANT, "UTC", "office")).toEqual({
      contextKey: "default",
      eligible: true,
      ordinary: { kind: "programs", count: 3 },
      marathon: null,
    });
  });

  it("changes when the winning rule changes the turn's settings", () => {
    const resized = programmingRule("resize", [
      {
        assignmentId: "office",
        ordinary: { kind: "programs", count: 2 },
        marathon: { mode: "inherit" },
      },
    ]);

    expect(
      turnTerms([resized], ASSIGNMENTS, INSTANT, "UTC", "office"),
    ).not.toEqual(turnTerms([], ASSIGNMENTS, INSTANT, "UTC", "office"));
  });

  it("stays the same when a rule that does not touch the turn changes", () => {
    const joins = programmingRule("joins", ["christmas"]);
    const renamed = { ...joins, priority: 4 };

    expect(turnTerms([joins], ASSIGNMENTS, INSTANT, "UTC", "office")).toEqual(
      turnTerms([renamed], ASSIGNMENTS, INSTANT, "UTC", "office"),
    );
  });

  it("changes when a feature takes the turn's context, or its source loses eligibility", () => {
    const feature = programmingRule("feature", ["christmas"], {
      behavior: "feature",
    });

    expect(turnTerms([feature], ASSIGNMENTS, INSTANT, "UTC", "office")).toEqual(
      {
        contextKey: "rule:feature",
        eligible: false,
        ordinary: null,
        marathon: null,
      },
    );
  });
});
