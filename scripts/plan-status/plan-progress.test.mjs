import { describe, expect, it } from "vitest";

import {
  PLAN_END,
  PLAN_START,
  describeProgress,
  parseTickets,
  renderIndexBlock,
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

describe("renderIndexBlock", () => {
  it("groups plans under one heading per feature folder", () => {
    const tickets = parseTickets(plan);
    const block = renderIndexBlock([
      { title: "A", feature: "001-mvp", file: "001-mvp/0002-a.md", tickets },
      { title: "B", feature: "001-mvp", file: "001-mvp/0003-b.md", tickets },
      { title: "C", feature: "003-auth", file: "003-auth/0001-c.md", tickets },
    ]);
    expect(block.split("\n").slice(2, -1)).toEqual([
      "### 001-mvp",
      "",
      "- [A](001-mvp/0002-a.md) - 1 of 3 tickets complete",
      "- [B](001-mvp/0003-b.md) - 1 of 3 tickets complete",
      "",
      "### 003-auth",
      "",
      "- [C](003-auth/0001-c.md) - 1 of 3 tickets complete",
      "",
    ]);
  });
});
