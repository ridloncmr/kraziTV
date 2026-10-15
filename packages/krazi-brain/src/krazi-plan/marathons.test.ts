import { describe, expect, it } from "vitest";

import {
  collectionAssignment,
  generateInChunks,
  sequentialBlockIds,
} from "../testing/programming-assignments.js";
import { scheduleMedia } from "../testing/schedule-media.js";
import type { ScheduleMedia } from "../schedule/contracts.js";
import type {
  GeneratedBlock,
  MarathonSettings,
  ProgrammingAssignment,
} from "./contracts.js";
import {
  generateProgramming,
  type GenerateProgrammingOptions,
} from "./generate-programming.js";
import { findStretchProblem } from "./stretch-settings.js";

// 2026-01-01T00:00:00.000Z as a UTC millisecond schedule anchor.
const STARTS_AT = 1_767_225_600_000;
const DAY_MS = 24 * 60 * 60 * 1000;

// `count` 22-minute episodes named `<prefix>1`, `<prefix>2`, ...
function episodes(prefix: string, count: number): ScheduleMedia[] {
  return Array.from({ length: count }, (_, index) =>
    scheduleMedia(`${prefix}${index + 1}`, { durationMs: 22 * 60_000 }),
  );
}

// Two programs a turn, or six in a marathon when `marathon` is set.
function source(id: string, marathon = false): ProgrammingAssignment {
  return collectionAssignment(id, `c-${id}`, episodes(id, 30), {
    ordinary: { kind: "programs", count: 2 },
    marathon: marathon ? { kind: "programs", count: 6 } : null,
  });
}

const OFFICE = source("office", true);
const PARKS = source("parks");
const SCRUBS = source("scrubs");

function options(
  assignments: readonly ProgrammingAssignment[],
  marathons: MarathonSettings,
  overrides: Partial<GenerateProgrammingOptions> = {},
): GenerateProgrammingOptions {
  return {
    channelSeed: 0x5d4886b3,
    programmingSeed: 0x1234abcd,
    rebuildCount: 0,
    marathons,
    assignments,
    latestTurn: undefined,
    progress: [],
    startsAt: STARTS_AT,
    through: STARTS_AT + 2 * DAY_MS,
    nextSequenceNumber: 0,
    maxEntries: 5000,
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

// The completed rounds' marathon blocks, keyed by round.
function marathonRounds(blocks: readonly GeneratedBlock[]): number[] {
  const last = blocks.at(-1)?.roundNumber ?? 0;
  return blocks
    .filter((block) => block.marathon && block.roundNumber < last)
    .map((block) => block.roundNumber);
}

describe("generateProgramming: generated marathons", () => {
  it("starts at most one marathon a round, extending that source's turn", () => {
    const { blocks, entries } = generated(
      generateProgramming(
        options([OFFICE, source("parks", true), SCRUBS], {
          chancePercent: 100,
          minOrdinaryRounds: 0,
        }),
      ),
    );

    const rounds = marathonRounds(blocks);
    expect(rounds.length).toBeGreaterThan(5);
    expect(new Set(rounds).size).toBe(rounds.length);
    for (const block of blocks.filter((b) => b.marathon).slice(0, -1)) {
      expect(block.size).toEqual({ kind: "programs", value: 6 });
      expect(
        entries.filter((entry) => entry.programmingBlockId === block.id),
      ).toHaveLength(6);
    }
  });

  it("waits two completed ordinary rounds between marathons with a cooldown of two", () => {
    const { blocks } = generated(
      generateProgramming(
        options([OFFICE, PARKS, SCRUBS], {
          chancePercent: 100,
          minOrdinaryRounds: 2,
        }),
      ),
    );

    const rounds = marathonRounds(blocks);
    expect(rounds.slice(0, 3)).toEqual([1, 4, 7]);
  });

  it("allows a marathon in the very next round with a cooldown of zero, and none at 0%", () => {
    const every = generated(
      generateProgramming(
        options([OFFICE, PARKS], { chancePercent: 100, minOrdinaryRounds: 0 }),
      ),
    );
    const never = generated(
      generateProgramming(
        options([OFFICE, PARKS], { chancePercent: 0, minOrdinaryRounds: 0 }),
      ),
    );

    expect(marathonRounds(every.blocks).slice(0, 4)).toEqual([1, 2, 3, 4]);
    expect(never.blocks.some((block) => block.marathon)).toBe(false);
  });

  it("decides chance once a round from the seed, so some rounds have none", () => {
    const { blocks } = generated(
      generateProgramming(
        options(
          [OFFICE, PARKS, SCRUBS],
          { chancePercent: 30, minOrdinaryRounds: 0 },
          { through: STARTS_AT + 7 * DAY_MS },
        ),
      ),
    );

    const rounds = marathonRounds(blocks);
    const total = blocks.at(-1)?.roundNumber ?? 0;
    expect(rounds.length).toBeGreaterThan(0);
    expect(rounds.length).toBeLessThan(total - 1);
  });

  it("resumes the collection's saved progress in its playback mode", () => {
    const { entries } = generated(
      generateProgramming(
        options([OFFICE, PARKS], { chancePercent: 100, minOrdinaryRounds: 1 }),
      ),
    );

    const office = entries.filter(
      (entry) => entry.mediaCollectionId === "c-office",
    );
    expect(office.map((entry) => entry.mediaItemId).slice(0, 14)).toEqual(
      episodes("office", 14).map((media) => media.id),
    );
    expect(new Set(office.map((entry) => entry.playbackMode))).toEqual(
      new Set(["chronological"]),
    );
  });

  it("discards an opportunity that lands on a single item, without replacement", () => {
    const special = scheduleMedia("special", { durationMs: 30 * 60_000 });
    const holiday: ProgrammingAssignment = {
      ...OFFICE,
      members: [
        { kind: "media_item", media: special },
        {
          kind: "collection",
          mediaCollectionId: "c-office",
          members: episodes("office", 30),
        },
      ],
    };

    const { blocks } = generated(
      generateProgramming(
        options([holiday, PARKS], { chancePercent: 100, minOrdinaryRounds: 0 }),
      ),
    );

    const officeTurns = blocks.filter(
      (block) => block.assignmentId === "office",
    );
    // Round one's turn goes to the special and stays ordinary; no other
    // source takes the round's lost opportunity.
    expect(officeTurns[0]).toMatchObject({
      source: { kind: "media_item" },
      marathon: false,
      size: null,
    });
    expect(
      blocks.filter((b) => b.roundNumber === 1).some((b) => b.marathon),
    ).toBe(false);
    expect(officeTurns[1]).toMatchObject({
      source: { kind: "collection", mediaCollectionId: "c-office" },
      marathon: true,
    });
  });

  it("extends only the current member's collection on a multi-member assignment", () => {
    const sitcoms: ProgrammingAssignment = {
      ...OFFICE,
      id: "sitcoms",
      members: [
        {
          kind: "collection",
          mediaCollectionId: "c-a",
          members: episodes("a", 9),
        },
        {
          kind: "collection",
          mediaCollectionId: "c-b",
          members: episodes("b", 9),
        },
      ],
    };

    const { blocks, entries } = generated(
      generateProgramming(
        options([sitcoms, PARKS], { chancePercent: 100, minOrdinaryRounds: 0 }),
      ),
    );

    for (const block of blocks.filter((b) => b.marathon).slice(0, -1)) {
      const aired = entries.filter(
        (entry) => entry.programmingBlockId === block.id,
      );
      expect(aired).toHaveLength(6);
      expect(new Set(aired.map((entry) => entry.mediaCollectionId)).size).toBe(
        1,
      );
    }
  });

  it.each([1, 4, 9])(
    "reproduces the same chance outcomes in chunks of %i",
    (chunkSize) => {
      const run = (size: number) =>
        generateInChunks(
          {
            ...options([OFFICE, source("parks", true), SCRUBS], {
              chancePercent: 40,
              minOrdinaryRounds: 1,
            }),
            createBlockId: sequentialBlockIds(),
          },
          size,
        );

      expect(run(chunkSize)).toEqual(run(100_000));
    },
  );
});

describe("findStretchProblem: marathon settings", () => {
  it.each([
    [
      { kind: "programs", count: 3 },
      { kind: "programs", count: 8 },
    ],
    [
      { kind: "airtime_range", minMinutes: 60, maxMinutes: 120 },
      { kind: "airtime", minutes: 180 },
    ],
    [
      { kind: "airtime", minutes: 60 },
      { kind: "airtime_range", minMinutes: 90, maxMinutes: 180 },
    ],
  ] as const)("accepts ordinary %o with marathon %o", (ordinary, marathon) => {
    expect(findStretchProblem(ordinary, marathon)).toBeNull();
  });

  it.each([
    [
      { kind: "programs", count: 3 },
      { kind: "airtime", minutes: 180 },
      "a marathon must use the ordinary stretch's unit: programs extend programs, airtime extends airtime",
    ],
    [
      { kind: "programs", count: 3 },
      { kind: "programs", count: 3 },
      "a marathon must be longer than the ordinary stretch",
    ],
    [
      { kind: "airtime_range", minMinutes: 60, maxMinutes: 120 },
      { kind: "airtime_range", minMinutes: 120, maxMinutes: 200 },
      "a marathon must be longer than the ordinary stretch",
    ],
    [
      { kind: "programs", count: 3 },
      { kind: "programs", count: 0 },
      "marathon count must be a positive integer",
    ],
  ] as const)(
    "refuses ordinary %o with marathon %o",
    (ordinary, marathon, problem) => {
      expect(findStretchProblem(ordinary, marathon)).toBe(problem);
    },
  );
});

describe("generateProgramming: the turn-start cooldown recheck", () => {
  // Parks' finished turn opened round 3; Office holds the round's
  // opportunity, one ordinary round after the last marathon.
  const latestTurn = {
    block: {
      id: "parks-turn",
      assignmentId: "parks",
      source: {
        kind: "collection" as const,
        mediaCollectionId: "c-parks",
        playbackMode: "chronological" as const,
      },
      roundNumber: 3,
      turnIndex: 0,
      startsAt: STARTS_AT,
      size: { kind: "programs" as const, value: 2 },
      marathon: false,
      checkpoint: {
        roundNumber: 3,
        pending: ["parks", "office"],
        served: [],
        skipped: [],
        lastAiredAssignmentId: "office",
        nextMemberPositions: {},
        marathonOpportunity: { assignmentId: "office", started: false },
        roundCommittedProgram: false,
        ordinaryRoundsSinceMarathon: 1,
      },
    },
    airedPrograms: 2,
    airedMs: 44 * 60_000,
  };

  it.each([
    [1, true],
    [2, false],
  ])(
    "with a cooldown of %i, the reserved turn is a marathon: %s",
    (minOrdinaryRounds, marathon) => {
      const { blocks } = generated(
        generateProgramming(
          options(
            [OFFICE, PARKS],
            { chancePercent: 100, minOrdinaryRounds },
            { latestTurn, maxEntries: 1 },
          ),
        ),
      );

      expect(blocks[0]).toMatchObject({ assignmentId: "office", marathon });
    },
  );
});
