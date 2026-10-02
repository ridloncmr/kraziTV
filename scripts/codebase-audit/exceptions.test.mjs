import { describe, expect, it } from "vitest";

import { applyExceptions, matches } from "./exceptions.mjs";

const finding = (rule, files) => ({
  rule,
  severity: "error",
  files,
  message: "",
});

describe("matches", () => {
  it("needs the same rule and every finding file covered", () => {
    const exception = { rule: "grouping", files: ["a/b/"], reason: "r" };

    expect(matches(exception, finding("grouping", ["a/b/c.ts"]))).toBe(true);
    expect(matches(exception, finding("grouping", ["a/bc.ts"]))).toBe(false);
    expect(matches(exception, finding("src-root", ["a/b/c.ts"]))).toBe(false);
    expect(matches(exception, finding("grouping", ["a/b/c.ts", "x.ts"]))).toBe(
      false,
    );
  });

  it("matches exact file paths without a trailing slash", () => {
    const exception = { rule: "r", files: ["a/b.ts"], reason: "r" };

    expect(matches(exception, finding("r", ["a/b.ts"]))).toBe(true);
    expect(matches(exception, finding("r", ["a/b.tsx"]))).toBe(false);
  });
});

describe("applyExceptions", () => {
  it("separates excepted findings, keeps their reason, and reports stale exceptions", () => {
    const used = { rule: "r", files: ["a.ts"], reason: "accepted" };
    const stale = { rule: "gone", files: ["b.ts"], reason: "old" };

    const { active, excepted } = applyExceptions(
      [finding("r", ["a.ts"]), finding("other", ["c.ts"])],
      [used, stale],
    );

    expect(excepted).toEqual([
      { ...finding("r", ["a.ts"]), reason: "accepted" },
    ]);
    expect(active.map((f) => f.rule)).toEqual(["other", "stale-exception"]);
  });
});
