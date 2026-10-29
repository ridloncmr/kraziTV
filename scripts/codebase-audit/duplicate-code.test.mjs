import { describe, expect, it } from "vitest";

import { findingsFromClones } from "./duplicate-code.mjs";

const repoRoot = "/repo";

// Builds one jscpd clone between two repo-relative files.
function clone(first, second) {
  return {
    lines: 12,
    firstFile: { name: `${repoRoot}/${first}`, start: 1, end: 12 },
    secondFile: { name: `${repoRoot}/${second}`, start: 20, end: 31 },
  };
}

describe("findingsFromClones", () => {
  it("reports a copy inside one package for review and across packages as an error", () => {
    const findings = findingsFromClones(
      repoRoot,
      [
        clone("apps/server/src/a.ts", "apps/server/src/b.ts"),
        clone("apps/server/src/a.ts", "packages/media/src/c.ts"),
      ],
      [],
    );

    expect(
      findings.map((f) => `${f.severity}:${f.rule}:${f.files.join(",")}`),
    ).toEqual([
      "review:duplicate-code:apps/server/src/a.ts,apps/server/src/b.ts",
      "error:cross-package-copy:apps/server/src/a.ts,packages/media/src/c.ts",
    ]);
  });

  it("drops every clone that touches an excluded path", () => {
    const migrations = "apps/server/src/database/migrations/";
    const findings = findingsFromClones(
      repoRoot,
      [
        clone(
          `${migrations}005-schedules.ts`,
          `${migrations}027-reservations.ts`,
        ),
        clone(
          `${migrations}005-schedules.ts`,
          "apps/server/src/schedules/x.ts",
        ),
        clone("apps/server/src/a.ts", "apps/server/src/b.ts"),
      ],
      [migrations],
    );

    expect(findings.map((f) => f.files)).toEqual([
      ["apps/server/src/a.ts", "apps/server/src/b.ts"],
    ]);
  });
});
