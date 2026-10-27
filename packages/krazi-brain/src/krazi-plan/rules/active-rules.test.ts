import { describe, expect, it } from "vitest";

import {
  collectionAssignment,
  programmingRule as rule,
} from "../../testing/programming-assignments.js";
import { scheduleMedia } from "../../testing/schedule-media.js";
import { decideRule, ruleScope } from "./active-rules.js";

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

describe("decideRule", () => {
  it("activates only the applicable rules at the highest priority", () => {
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
      priority: 5,
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

    expect(decision.active.map(({ id }) => id)).toEqual(["december"]);
    expect(decision.passedOver).toEqual([]);
  });

  it("activates every usable rule at that priority, in saved rule order, then ID", () => {
    const decision = decideRule(
      [
        rule("c", ["office"], { priority: 3, ruleOrder: 2 }),
        rule("b", ["christmas"], { priority: 3, ruleOrder: 1 }),
        rule("a", ["parks"], { priority: 3, ruleOrder: 2 }),
        rule("low", ["parks"], { priority: 2, ruleOrder: 0 }),
      ],
      ASSIGNMENTS,
      DECEMBER_4,
      "UTC",
    );

    expect(decision.active.map(({ id }) => id)).toEqual(["b", "a", "c"]);
  });

  it("drops an unusable rule from its priority and reports it, leaving lower priorities unexamined", () => {
    const decision = decideRule(
      [
        rule("usable", ["christmas"], { priority: 4, ruleOrder: 2 }),
        rule("unusable", ["empty"], { priority: 4, ruleOrder: 1 }),
        rule("lower-unusable", ["empty"], { priority: 3 }),
      ],
      ASSIGNMENTS,
      DECEMBER_4,
      "UTC",
    );

    expect(decision.active.map(({ id }) => id)).toEqual(["usable"]);
    expect(decision.passedOver).toEqual([
      { ruleId: "unusable", reason: "no_usable_source" },
    ]);
  });

  it("falls through a priority with no usable rule to the next, examining each once", () => {
    const first = rule("first", ["empty"], { priority: 4 });
    const second = rule("second", ["christmas"], { priority: 2 });

    expect(
      decideRule([second, first], ASSIGNMENTS, DECEMBER_4, "UTC"),
    ).toMatchObject({
      active: [second],
      passedOver: [{ ruleId: "first", reason: "no_usable_source" }],
    });
  });

  it("falls back to default rotation when no applicable rule can provide a program", () => {
    const decision = decideRule(
      [
        rule("first", ["empty"], { priority: 4 }),
        rule("gone", ["deleted-assignment"], { priority: 3 }),
        rule("none", [], { priority: 3, ruleOrder: 1 }),
      ],
      ASSIGNMENTS,
      DECEMBER_4,
      "UTC",
    );

    expect(decision.active).toEqual([]);
    expect(decision.passedOver).toEqual([
      { ruleId: "first", reason: "no_usable_source" },
      { ruleId: "gone", reason: "no_usable_source" },
      { ruleId: "none", reason: "no_sources" },
    ]);
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
  it("rotates default assignments when no rule is active", () => {
    const scope = ruleScope([], ASSIGNMENTS);

    expect(scope.contextKey).toBe("default");
    expect(scope.eligible.map(({ id }) => id)).toEqual(["office", "parks"]);
    expect([...scope.ruleDriven]).toEqual([]);
  });

  it("adds a join rule's sources once, in saved assignment order", () => {
    const scope = ruleScope(
      [rule("december", ["christmas", "office"])],
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

  it("adds every active join rule's sources to the default lineup", () => {
    const scope = ruleScope(
      [rule("december", ["christmas"]), rule("winter", ["empty", "office"])],
      ASSIGNMENTS,
    );

    expect(scope.contextKey).toBe("default");
    expect(scope.eligible.map(({ id }) => id)).toEqual([
      "office",
      "parks",
      "christmas",
      "empty",
    ]);
    expect([...scope.ruleDriven]).toEqual(["christmas", "empty"]);
  });

  it("gives a lone feature rule its own context with only its sources", () => {
    const scope = ruleScope(
      [rule("fridays", ["christmas", "parks"], { behavior: "feature" })],
      ASSIGNMENTS,
    );

    expect(scope.contextKey).toBe("rule:fridays");
    expect(scope.eligible.map(({ id }) => id)).toEqual(["parks", "christmas"]);
    expect([...scope.ruleDriven].sort()).toEqual(["christmas", "parks"]);
  });

  it("combines feature rules and adds join rules' sources under one combination context", () => {
    const scope = ruleScope(
      [
        rule("nick", ["parks"], { behavior: "feature", ruleOrder: 0 }),
        rule("halloween", ["christmas"], { ruleOrder: 1 }),
        rule("cartoon", ["office", "parks"], {
          behavior: "feature",
          ruleOrder: 2,
        }),
      ],
      ASSIGNMENTS,
    );

    // Takeover IDs are sorted, so saved rule order never changes the key.
    expect(scope.contextKey).toBe("rule:cartoon+nick");
    expect(scope.eligible.map(({ id }) => id)).toEqual([
      "office",
      "parks",
      "christmas",
    ]);
    expect([...scope.ruleDriven].sort()).toEqual([
      "christmas",
      "office",
      "parks",
    ]);
  });

  it("runs a shared source with the settings of the first active rule naming it", () => {
    const sized = (id: string, ruleOrder: number, count: number) =>
      rule(
        id,
        [
          {
            assignmentId: "parks",
            ordinary: { kind: "programs", count },
            marathon: { mode: "inherit" },
          },
        ],
        { behavior: "feature", ruleOrder },
      );

    const scope = ruleScope(
      [sized("later-id", 0, 2), sized("earlier-id", 1, 5)],
      [parks],
    );

    expect(scope.eligible).toHaveLength(1);
    expect(scope.eligible[0]?.ordinary).toEqual({ kind: "programs", count: 2 });
  });
});
