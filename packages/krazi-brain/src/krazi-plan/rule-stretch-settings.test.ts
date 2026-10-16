import { describe, expect, it } from "vitest";

import {
  collectionAssignment,
  programmingRule,
  sequentialBlockIds,
} from "../testing/programming-assignments.js";
import { scheduleMedia } from "../testing/schedule-media.js";
import type { ScheduleMedia } from "../schedule/contracts.js";
import type {
  GeneratedBlock,
  LatestTurn,
  ProgrammingAssignment,
  ProgrammingRule,
} from "./contracts.js";
import {
  generateProgramming,
  type GenerateProgrammingOptions,
} from "./generate-programming.js";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const utc = (iso: string) => Date.parse(iso);

// `count` items of `minutes` each, named `<prefix>1`, `<prefix>2`, ...
function items(
  prefix: string,
  count: number,
  minutes: number,
): ScheduleMedia[] {
  return Array.from({ length: count }, (_, index) =>
    scheduleMedia(`${prefix}${index + 1}`, { durationMs: minutes * MINUTE_MS }),
  );
}

function options(
  assignments: readonly ProgrammingAssignment[],
  rules: readonly ProgrammingRule[],
  overrides: Partial<GenerateProgrammingOptions> = {},
): GenerateProgrammingOptions {
  return {
    channelSeed: 0x5d4886b3,
    programmingSeed: 0x1234abcd,
    rebuildCount: 0,
    marathons: { chancePercent: 0, minOrdinaryRounds: 2 },
    assignments,
    rules,
    timeZone: "UTC",
    latestTurn: undefined,
    progress: [],
    startsAt: utc("2026-12-01T00:00:00Z"),
    through: utc("2026-12-15T00:00:00Z"),
    nextSequenceNumber: 0,
    maxEntries: 100_000,
    createBlockId: sequentialBlockIds(),
    ...overrides,
  };
}

function generated(result: ReturnType<typeof generateProgramming>) {
  if (result.kind !== "generated") {
    throw new Error(`expected generated, got ${result.reason}`);
  }
  return result;
}

// How many entries each block aired.
function programsOf(
  blocks: readonly GeneratedBlock[],
  entries: readonly { programmingBlockId: string }[],
) {
  return (block: GeneratedBlock) =>
    entries.filter((entry) => entry.programmingBlockId === block.id).length;
}

// Movies air one 90-minute film a turn, with a three-film marathon.
const MOVIES = collectionAssignment(
  "movies",
  "c-movies",
  items("film", 60, 90),
  {
    ordinary: { kind: "programs", count: 1 },
    marathon: { kind: "programs", count: 3 },
  },
);
const OFFICE = collectionAssignment(
  "office",
  "c-office",
  items("office", 60, 30),
  {
    ordinary: { kind: "programs", count: 2 },
  },
);

describe("generateProgramming: rule-specific stretch settings", () => {
  it("airs two films a turn, and three for a marathon, only while the Friday feature wins", () => {
    const fridays = programmingRule(
      "fridays",
      [
        {
          assignmentId: "movies",
          ordinary: { kind: "programs", count: 2 },
          marathon: {
            mode: "replace",
            stretch: { kind: "programs", count: 3 },
          },
        },
      ],
      {
        behavior: "feature",
        conditions: {
          weekdays: [5],
          window: { startMinute: 18 * 60, endMinute: 23 * 60 },
        },
      },
    );

    const { blocks, entries } = generated(
      generateProgramming(
        options([OFFICE, MOVIES], [fridays], {
          marathons: { chancePercent: 50, minOrdinaryRounds: 0 },
        }),
      ),
    );
    const programs = programsOf(blocks, entries);

    const featured = blocks.filter(
      (block) => block.winningRuleId === "fridays",
    );
    expect(featured.length).toBeGreaterThan(3);
    for (const block of featured.slice(0, -1)) {
      expect(block.size?.value).toBe(block.marathon ? 3 : 2);
      expect(block.settingOrigins).toEqual({
        ordinary: "rule",
        marathon: "rule",
      });
    }
    const normal = blocks.filter(
      (block) =>
        block.assignmentId === "movies" && block.winningRuleId === null,
    );
    expect(normal.length).toBeGreaterThan(3);
    for (const block of normal) {
      expect(block.size?.value).toBe(block.marathon ? 3 : 1);
      expect(block.settingOrigins).toEqual({
        ordinary: "assignment",
        marathon: "assignment",
      });
    }
    // The assignment itself is unchanged: its own turns still air one film.
    expect(
      normal
        .filter((block) => !block.marathon)
        .every((block) => programs(block) <= 1),
    ).toBe(true);
  });

  it("keeps a default source's settings when a join wins without naming it, and ignores losing rules", () => {
    const join = programmingRule(
      "join",
      [
        {
          assignmentId: "movies",
          ordinary: { kind: "programs", count: 2 },
          marathon: { mode: "inherit" },
        },
      ],
      { priority: 2 },
    );
    const losing = programmingRule("losing", [
      {
        assignmentId: "office",
        ordinary: { kind: "programs", count: 5 },
        marathon: { mode: "inherit" },
      },
    ]);

    const { blocks } = generated(
      generateProgramming(options([OFFICE, MOVIES], [join, losing])),
    );

    for (const block of blocks) {
      if (block.assignmentId === "office") {
        expect(block.size).toEqual({ kind: "programs", value: 2 });
        expect(block.settingOrigins.ordinary).toBe("assignment");
      } else {
        expect(block.size).toEqual({ kind: "programs", value: 2 });
        expect(block.settingOrigins.ordinary).toBe("rule");
      }
    }
  });

  it("never resizes a retained turn when the calendar changes; the next turn takes the new settings", () => {
    const evenings = programmingRule(
      "evenings",
      [
        {
          assignmentId: "office",
          ordinary: { kind: "programs", count: 6 },
          marathon: { mode: "inherit" },
        },
      ],
      { conditions: { window: { startMinute: 18 * 60, endMinute: 19 * 60 } } },
    );

    const { blocks, entries } = generated(
      generateProgramming(options([OFFICE], [evenings])),
    );
    const programs = programsOf(blocks, entries);

    const evening = blocks.filter(
      (block) => block.winningRuleId === "evenings",
    );
    expect(evening.length).toBeGreaterThan(5);
    for (const block of evening) {
      // Started in the window, it keeps all six programs well past 19:00.
      expect(block.size?.value).toBe(6);
      expect(programs(block)).toBe(6);
      const next = blocks[blocks.indexOf(block) + 1];
      if (next !== undefined && next.startsAt % DAY_MS >= 19 * 60 * MINUTE_MS) {
        expect(next.size?.value).toBe(2);
      }
    }
  });

  it("turns a reserved marathon the winning rule disables into an ordinary turn", () => {
    const quiet = programmingRule("quiet", [
      {
        assignmentId: "movies",
        ordinary: null,
        marathon: { mode: "disabled" },
      },
    ]);
    // Movies' turn is next, holding the round's marathon opportunity.
    const latestTurn: LatestTurn = {
      block: {
        id: "office-turn",
        assignmentId: "office",
        source: {
          kind: "collection",
          mediaCollectionId: "c-office",
          playbackMode: "chronological",
        },
        roundNumber: 2,
        turnIndex: 0,
        startsAt: utc("2026-12-01T00:00:00Z"),
        size: { kind: "programs", value: 2 },
        marathon: false,
        winningRuleId: null,
        settingOrigins: { ordinary: "assignment", marathon: "assignment" },
        endedByEdit: false,
        checkpoint: {
          activeContext: "default",
          contexts: {
            default: {
              roundNumber: 2,
              pending: ["office", "movies"],
              served: [],
              skipped: [],
              unservedRemoved: [],
              marathonOpportunity: { assignmentId: "movies", started: false },
              roundCommittedProgram: false,
            },
          },
          lastAiredAssignmentId: "movies",
          nextMemberPositions: {},
          ordinaryRoundsSinceMarathon: 5,
          rebuildCount: 0,
        },
      },
      airedPrograms: 2,
      airedMs: 60 * MINUTE_MS,
    };

    const run = (rules: ProgrammingRule[]) =>
      generated(
        generateProgramming(
          options([OFFICE, MOVIES], rules, {
            marathons: { chancePercent: 100, minOrdinaryRounds: 0 },
            latestTurn,
            startsAt: utc("2026-12-01T01:00:00Z"),
            maxEntries: 1,
          }),
        ),
      ).blocks[0];

    expect(run([])).toMatchObject({ assignmentId: "movies", marathon: true });
    expect(run([quiet])).toMatchObject({
      assignmentId: "movies",
      marathon: false,
      size: { kind: "programs", value: 1 },
      settingOrigins: { ordinary: "assignment", marathon: "disabled" },
    });
  });
});
