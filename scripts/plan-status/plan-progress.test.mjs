import { describe, expect, it } from "vitest";

import {
  PLAN_END,
  PLAN_START,
  describeProgress,
  parseTickets,
  upsertBlock,
} from "./plan-progress.mjs";

const plan = `# Plan

## Phase 1

### T-001: Done ticket

**Status**

Complete on 2026-09-28. Delivered the thing.

**Goal**

### T-002: Open ticket

**Goal**

Not started.

## Phase 2

### T-003: Blocked ticket

**Status**

Blocked on upstream. More detail.
`;

describe("parseTickets", () => {
  it("reads each ticket's status from its own Status block", () => {
    expect(parseTickets(plan)).toEqual([
      {
        id: "T-001",
        title: "Done ticket",
        status: { complete: true, label: "Complete on 2026-09-28" },
      },
      {
        id: "T-002",
        title: "Open ticket",
        status: { complete: false, label: "Open" },
      },
      {
        id: "T-003",
        title: "Blocked ticket",
        status: { complete: false, label: "Blocked on upstream" },
      },
    ]);
  });

  it("does not borrow a later ticket's Status block", () => {
    const [, open] = parseTickets(plan);
    expect(open.status.label).toBe("Open");
  });
});

describe("describeProgress", () => {
  it("counts only completed tickets", () => {
    expect(describeProgress(parseTickets(plan))).toBe(
      "1 of 3 tickets complete",
    );
  });
});

describe("upsertBlock", () => {
  const block = `${PLAN_START}\nnew\n${PLAN_END}`;
  const isTitle = (line) => line.startsWith("# ");

  it("inserts the block under the title when it is missing", () => {
    expect(
      upsertBlock("# Plan\n\nBody\n", PLAN_START, PLAN_END, block, isTitle),
    ).toBe(`# Plan\n\n${block}\n\nBody\n`);
  });

  it("replaces only the existing block", () => {
    const before = `# Plan\n\n${PLAN_START}\nold\n${PLAN_END}\n\nBody\n`;
    expect(upsertBlock(before, PLAN_START, PLAN_END, block, isTitle)).toBe(
      `# Plan\n\n${block}\n\nBody\n`,
    );
  });

  it("rejects a start marker without its end marker", () => {
    expect(() =>
      upsertBlock(
        `# Plan\n${PLAN_START}\n`,
        PLAN_START,
        PLAN_END,
        block,
        isTitle,
      ),
    ).toThrow(/end marker/);
  });
});
