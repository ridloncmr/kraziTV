import { describe, expect, it } from "vitest";

import {
  collectionAssignment,
  programmingRule,
} from "../../testing/programming-assignments.js";
import { scheduleMedia } from "../../testing/schedule-media.js";
import type { RuleSource } from "../contracts.js";
import {
  applyRuleSettings,
  findNamingRule,
  findRuleSourceProblem,
  settingOrigins,
} from "./rule-settings.js";

const MOVIES = collectionAssignment(
  "movies",
  "c-movies",
  [scheduleMedia("film", { durationMs: 90 * 60_000 })],
  {
    ordinary: { kind: "programs", count: 1 },
    marathon: { kind: "programs", count: 3 },
  },
);

function source(partial: Partial<RuleSource>): RuleSource {
  return {
    assignmentId: "movies",
    ordinary: null,
    marathon: { mode: "inherit" },
    ...partial,
  };
}

describe("applyRuleSettings", () => {
  it("keeps the assignment's settings when no active rule names it", () => {
    expect(applyRuleSettings(MOVIES, [])).toBe(MOVIES);
    expect(
      applyRuleSettings(MOVIES, [programmingRule("other", ["parks"])]),
    ).toBe(MOVIES);
  });

  it("takes settings from the first active rule naming the assignment, never merging", () => {
    const first = programmingRule("first", [
      "parks",
      source({ ordinary: { kind: "programs", count: 2 } }),
    ]);
    const second = programmingRule("second", [
      source({
        ordinary: { kind: "programs", count: 9 },
        marathon: { mode: "disabled" },
      }),
    ]);
    const active = [programmingRule("other", ["parks"]), first, second];

    expect(applyRuleSettings(MOVIES, active)).toMatchObject({
      ordinary: { kind: "programs", count: 2 },
      marathon: { kind: "programs", count: 3 },
    });
    expect(settingOrigins(active, "movies")).toEqual({
      ordinary: "rule",
      marathon: "assignment",
    });
    expect(findNamingRule(active, "movies")).toBe(first);
    expect(findNamingRule(active, "missing")).toBeUndefined();
  });

  it("replaces the ordinary stretch and keeps an inherited marathon", () => {
    const rule = programmingRule("fridays", [
      source({ ordinary: { kind: "programs", count: 2 } }),
    ]);

    expect(applyRuleSettings(MOVIES, [rule])).toMatchObject({
      ordinary: { kind: "programs", count: 2 },
      marathon: { kind: "programs", count: 3 },
      playbackMode: MOVIES.playbackMode,
    });
    expect(settingOrigins([rule], "movies")).toEqual({
      ordinary: "rule",
      marathon: "assignment",
    });
  });

  it("disables or replaces the marathon", () => {
    const disabled = programmingRule("quiet", [
      source({ marathon: { mode: "disabled" } }),
    ]);
    const replaced = programmingRule("binge", [
      source({
        marathon: { mode: "replace", stretch: { kind: "programs", count: 5 } },
      }),
    ]);

    expect(applyRuleSettings(MOVIES, [disabled]).marathon).toBeNull();
    expect(settingOrigins([disabled], "movies").marathon).toBe("disabled");
    expect(applyRuleSettings(MOVIES, [replaced]).marathon).toEqual({
      kind: "programs",
      count: 5,
    });
    expect(settingOrigins([replaced], "movies")).toEqual({
      ordinary: "assignment",
      marathon: "rule",
    });
  });

  it("reports assignment origins when no active rule names the assignment", () => {
    expect(settingOrigins([], "movies")).toEqual({
      ordinary: "assignment",
      marathon: "assignment",
    });
  });
});

describe("findRuleSourceProblem", () => {
  it("accepts an effective pair spec 0004 accepts", () => {
    expect(
      findRuleSourceProblem(
        source({
          ordinary: { kind: "programs", count: 2 },
          marathon: {
            mode: "replace",
            stretch: { kind: "programs", count: 3 },
          },
        }),
        MOVIES,
      ),
    ).toBeNull();
  });

  it("refuses an ordinary replacement that leaves an inherited marathon too short", () => {
    expect(
      findRuleSourceProblem(
        source({ ordinary: { kind: "programs", count: 3 } }),
        MOVIES,
      ),
    ).toBe("a marathon must be longer than the ordinary stretch");
  });

  it("refuses an assignment change that leaves a rule's inherited pair invalid", () => {
    expect(
      findRuleSourceProblem(source({}), {
        ...MOVIES,
        ordinary: { kind: "airtime", minutes: 120 },
      }),
    ).toBe(
      "a marathon must use the ordinary stretch's unit: programs extend programs, airtime extends airtime",
    );
  });

  it("checks a replacement's own shape", () => {
    expect(
      findRuleSourceProblem(
        source({ ordinary: { kind: "programs", count: 0 } }),
        MOVIES,
      ),
    ).toBe("count must be a positive integer");
  });
});
