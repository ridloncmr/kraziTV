import { describe, expect, it } from "vitest";

import { collectionAssignment } from "../../testing/programming-assignments.js";
import { scheduleMedia } from "../../testing/schedule-media.js";
import type { ProgrammingRule } from "../contracts.js";
import { decideRule, ruleScope } from "./winning-rule.js";

const DECEMBER_4 = Date.parse("2026-12-04T12:00:00Z"); // a Friday
const MOVIE = scheduleMedia("movie", { durationMs: 90 * 60_000 });

const office = collectionAssignment("office", "c-office", [MOVIE]);
const parks = collectionAssignment("parks", "c-parks", [MOVIE]);
const christmas = collectionAssignment("christmas", "c-christmas", [MOVIE], {
  participation: "rule_only",
});
const empty = collectionAssignment("empty", "c-empty", [], {
  participation: "rule_only",
});
const ASSIGNMENTS = [office, parks, christmas, empty];

/** A join rule that applies everywhere unless a test narrows it. */
function rule(
  id: string,
  sources: string[],
  partial: Partial<ProgrammingRule> = {},
): ProgrammingRule {
  return {
    id,
    behavior: "join",
    priority: 0,
    ruleOrder: 0,
    conditions: { dates: { kind: "any" }, weekdays: null, window: null },
    sources: sources.map((assignmentId) => ({ assignmentId })),
    ...partial,
  };
}

describe("decideRule", () => {
  it("picks the applicable rule with the highest priority", () => {
    const december = rule("december", ["christmas"], {
      priority: 3,
      conditions: {
        dates: { kind: "annual", startMonthDay: "12-01", endMonthDay: "12-31" },
        weekdays: null,
        window: null,
      },
    });
    const friday = rule("friday", ["parks"], {
      priority: 1,
      conditions: { dates: { kind: "any" }, weekdays: [5], window: null },
    });
    const july = rule("july", ["christmas"], {
      priority: 9,
      conditions: {
        dates: { kind: "annual", startMonthDay: "07-01", endMonthDay: "07-31" },
        weekdays: null,
        window: null,
      },
    });

    const decision = decideRule(
      [friday, july, december],
      ASSIGNMENTS,
      DECEMBER_4,
      "UTC",
    );

    expect(decision.winner?.id).toBe("december");
    expect(decision.passedOver).toEqual([]);
  });

  it("breaks a priority tie by saved rule order, then by ID", () => {
    const decide = (rules: ProgrammingRule[]) =>
      decideRule(rules, ASSIGNMENTS, DECEMBER_4, "UTC").winner?.id;

    expect(
      decide([
        rule("b", ["christmas"], { ruleOrder: 1 }),
        rule("a", ["christmas"], { ruleOrder: 2 }),
      ]),
    ).toBe("b");
    expect(
      decide([
        rule("b", ["christmas"], { ruleOrder: 1 }),
        rule("a", ["christmas"], { ruleOrder: 1 }),
      ]),
    ).toBe("a");
  });

  it("falls through a rule with no usable source to the next, examining each once", () => {
    const first = rule("first", ["empty"], { priority: 2 });
    const second = rule("second", ["christmas"], { priority: 1 });

    expect(
      decideRule([second, first], ASSIGNMENTS, DECEMBER_4, "UTC"),
    ).toMatchObject({ winner: second, passedOver: ["first"] });
  });

  it("falls back to default rotation when no applicable rule can provide a program", () => {
    const decision = decideRule(
      [
        rule("first", ["empty"], { priority: 2 }),
        rule("gone", ["deleted-assignment"], { priority: 1 }),
        rule("none", []),
      ],
      ASSIGNMENTS,
      DECEMBER_4,
      "UTC",
    );

    expect(decision.winner).toBeUndefined();
    expect(decision.passedOver).toEqual(["first", "gone", "none"]);
  });

  it("holds until the earliest instant any rule's applicability can change", () => {
    const evening = rule("evening", ["christmas"], {
      conditions: {
        dates: { kind: "any" },
        weekdays: null,
        window: { startMinute: 18 * 60, endMinute: 23 * 60 },
      },
    });

    expect(
      decideRule([evening], ASSIGNMENTS, DECEMBER_4, "UTC").validUntil,
    ).toBe(Date.parse("2026-12-04T18:00:00Z"));
    expect(decideRule([], ASSIGNMENTS, DECEMBER_4, "UTC").validUntil).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe("ruleScope", () => {
  it("rotates default assignments when no rule wins", () => {
    const scope = ruleScope(undefined, ASSIGNMENTS);

    expect(scope.contextKey).toBe("default");
    expect(scope.eligible.map(({ id }) => id)).toEqual(["office", "parks"]);
    expect([...scope.ruleDriven]).toEqual([]);
  });

  it("adds a join rule's sources once, in saved assignment order", () => {
    const scope = ruleScope(
      rule("december", ["christmas", "office"]),
      ASSIGNMENTS,
    );

    expect(scope.contextKey).toBe("default");
    expect(scope.eligible.map(({ id }) => id)).toEqual([
      "office",
      "parks",
      "christmas",
    ]);
    // Only a source the rule alone makes eligible may join a round under way.
    expect([...scope.ruleDriven]).toEqual(["christmas"]);
  });

  it("gives a feature rule its own context with only its sources", () => {
    const scope = ruleScope(
      rule("fridays", ["christmas", "parks"], { behavior: "feature" }),
      ASSIGNMENTS,
    );

    expect(scope.contextKey).toBe("rule:fridays");
    expect(scope.eligible.map(({ id }) => id)).toEqual(["parks", "christmas"]);
    expect([...scope.ruleDriven].sort()).toEqual(["christmas", "parks"]);
  });
});
