import { describe, expect, it } from "vitest";

import {
  collectionAssignment,
  generateInChunks,
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
  RotationCheckpoint,
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

// A sitcom of 30-minute episodes, three a turn.
function sitcom(id: string): ProgrammingAssignment {
  return collectionAssignment(id, `c-${id}`, items(id, 40, 30), {
    ordinary: { kind: "programs", count: 3 },
  });
}

const DEFAULTS = ["office", "parks", "scrubs", "frasier"].map(sitcom);
const CHRISTMAS = collectionAssignment(
  "christmas",
  "c-christmas",
  items("christmas", 20, 100),
  { participation: "rule_only", ordinary: { kind: "programs", count: 1 } },
);
const DECEMBER_DATES = {
  kind: "annual",
  startMonthDay: "12-01",
  endMonthDay: "12-31",
} as const;
const EVENINGS = { startMinute: 18 * 60, endMinute: 23 * 60 };

// Christmas joins all December and takes over December Friday evenings.
const DECEMBER = programmingRule("december", ["christmas"], {
  priority: 1,
  conditions: { dates: DECEMBER_DATES },
});
const FRIDAY_FEATURE = programmingRule("fridays", ["christmas"], {
  behavior: "feature",
  priority: 2,
  conditions: { dates: DECEMBER_DATES, weekdays: [5], window: EVENINGS },
});

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
    startsAt: utc("2026-11-27T00:00:00Z"),
    through: utc("2027-01-03T00:00:00Z"),
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

// Whether a UTC instant falls on a December Friday evening.
function inFeature(instant: number): boolean {
  const date = new Date(instant);
  const minute = (instant % DAY_MS) / MINUTE_MS;
  return (
    date.getUTCMonth() === 11 &&
    date.getUTCDay() === 5 &&
    minute >= EVENINGS.startMinute &&
    minute < EVENINGS.endMinute
  );
}

describe("generateProgramming: feature rules", () => {
  const { blocks, entries } = generated(
    generateProgramming(
      options([...DEFAULTS, CHRISTMAS], [DECEMBER, FRIDAY_FEATURE]),
    ),
  );

  it("plays only the featured source on December Friday evenings", () => {
    const featured = entries.filter((entry) => inFeature(entry.startsAt));
    expect(featured.length).toBeGreaterThan(10);
    for (const entry of featured) {
      expect(entry.mediaCollectionId).toBe("c-christmas");
    }
    const featureBlocks = blocks.filter(
      (block) => block.checkpoint.activeContext === "rule:fridays",
    );
    expect(featureBlocks.length).toBeGreaterThan(0);
    for (const block of featureBlocks) {
      expect(block.winningRuleId).toBe("fridays");
    }
  });

  it("resumes the mixed December rotation afterward and the defaults after December", () => {
    const december = entries.filter(
      (entry) =>
        !inFeature(entry.startsAt) &&
        entry.startsAt >= utc("2026-12-01T00:00:00Z") &&
        entry.startsAt < utc("2027-01-01T00:00:00Z"),
    );
    expect(new Set(december.map((entry) => entry.mediaCollectionId))).toEqual(
      new Set(["c-office", "c-parks", "c-scrubs", "c-frasier", "c-christmas"]),
    );
    const outside = entries.filter(
      (entry) =>
        entry.startsAt < utc("2026-12-01T00:00:00Z") ||
        entry.startsAt >= utc("2027-01-01T02:00:00Z"),
    );
    expect(
      outside.some((entry) => entry.mediaCollectionId === "c-christmas"),
    ).toBe(false);
  });

  it("resumes a suspended round's pending turns without replaying any", () => {
    // Every context's round gives each source at most one turn.
    const turns = new Map<string, string[]>();
    for (const block of blocks) {
      const key = `${block.checkpoint.activeContext}#${block.roundNumber}`;
      turns.set(key, [...(turns.get(key) ?? []), block.assignmentId ?? ""]);
    }
    for (const assigned of turns.values()) {
      expect(new Set(assigned).size).toBe(assigned.length);
    }
    // The first default turn after a feature takes the round's next pending source.
    const resumed = blocks.filter(
      (block, index) =>
        block.checkpoint.activeContext === "default" &&
        blocks[index - 1]?.checkpoint.activeContext === "rule:fridays",
    );
    expect(resumed.length).toBeGreaterThan(2);
    for (const block of resumed) {
      const before = lastDefaultBlockBefore(blocks, block);
      if (before?.roundNumber !== block.roundNumber) continue;
      // The suspended round's remaining turns, exactly, with no one replayed.
      const left = before.checkpoint.contexts.default?.pending.slice(1) ?? [];
      expect(
        [...(block.checkpoint.contexts.default?.pending ?? [])].sort(),
      ).toEqual([...left].sort());
    }
  });

  it.each([1, 4, 50])(
    "writes identical blocks and entries in chunks of %i",
    (chunkSize) => {
      const run = (size: number) =>
        generateInChunks(
          {
            ...options([...DEFAULTS, CHRISTMAS], [DECEMBER, FRIDAY_FEATURE], {
              startsAt: utc("2026-12-04T12:00:00Z"),
              through: utc("2026-12-12T12:00:00Z"),
            }),
            createBlockId: sequentialBlockIds(),
          },
          size,
        );

      const whole = run(100_000);
      expect(run(chunkSize)).toEqual(whole);
    },
  );
});

describe("generateProgramming: a feature taking over", () => {
  const office = sitcom("office");
  const evenings = programmingRule("evenings", ["christmas"], {
    behavior: "feature",
    conditions: { window: EVENINGS },
  });

  it("ends a stretch under way at the next program boundary", () => {
    const { entries, blocks } = generated(
      generateProgramming(
        options([office, CHRISTMAS], [evenings], {
          startsAt: utc("2026-12-04T17:15:00Z"),
          through: utc("2026-12-04T19:00:00Z"),
        }),
      ),
    );

    // The second episode, under way at 18:00, finishes; the third never airs.
    expect(
      entries.map((entry) => [
        new Date(entry.startsAt).toISOString().slice(11, 16),
        entry.mediaCollectionId,
      ]),
    ).toEqual([
      ["17:15", "c-office"],
      ["17:45", "c-office"],
      ["18:15", "c-christmas"],
    ]);
    expect(blocks.map((block) => block.checkpoint.activeContext)).toEqual([
      "default",
      "rule:evenings",
    ]);
  });

  it("ends a marathon under way after its current program, without debt", () => {
    const binge = collectionAssignment(
      "office",
      "c-office",
      items("office", 40, 30),
      {
        ordinary: { kind: "programs", count: 1 },
        marathon: { kind: "programs", count: 6 },
      },
    );

    const { blocks, entries } = generated(
      generateProgramming(
        options([binge, CHRISTMAS], [evenings], {
          marathons: { chancePercent: 100, minOrdinaryRounds: 0 },
          startsAt: utc("2026-12-04T17:00:00Z"),
          through: utc("2026-12-05T01:00:00Z"),
        }),
      ),
    );

    // Six 30-minute episodes would run to 20:00; two air before 18:00.
    expect(blocks[0]).toMatchObject({ assignmentId: "office", marathon: true });
    const marathon = entries.filter(
      (entry) => entry.programmingBlockId === blocks[0]?.id,
    );
    expect(marathon.map((entry) => entry.mediaCollectionId)).toEqual([
      "c-office",
      "c-office",
    ]);
    expect(
      entries.find((entry) => entry.startsAt === utc("2026-12-04T18:00:00Z"))
        ?.mediaCollectionId,
    ).toBe("c-christmas");
    // Office's next turn starts at its full size, never the four left over.
    const later = blocks.find(
      (block) =>
        block.assignmentId === "office" &&
        block.startsAt >= utc("2026-12-04T23:00:00Z"),
    );
    expect(later?.size).toEqual({
      kind: "programs",
      value: later?.marathon ? 6 : 1,
    });
  });

  it("lets a higher-priority feature suspend a lower one", () => {
    const halloween = collectionAssignment(
      "halloween",
      "c-halloween",
      items("halloween", 10, 100),
      { participation: "rule_only", ordinary: { kind: "programs", count: 1 } },
    );
    const late = programmingRule("late", ["halloween"], {
      behavior: "feature",
      priority: 5,
      conditions: { window: { startMinute: 21 * 60, endMinute: 23 * 60 } },
    });

    const { entries } = generated(
      generateProgramming(
        options([office, CHRISTMAS, halloween], [evenings, late], {
          startsAt: utc("2026-12-04T18:00:00Z"),
          through: utc("2026-12-05T00:00:00Z"),
        }),
      ),
    );

    for (const entry of entries) {
      const minute = (entry.startsAt % DAY_MS) / MINUTE_MS;
      const expected =
        minute >= 21 * 60
          ? "c-halloween"
          : minute >= 18 * 60
            ? "c-christmas"
            : "c-office";
      if (entry.startsAt < utc("2026-12-04T23:00:00Z")) {
        expect(entry.mediaCollectionId).toBe(expected);
      }
    }
  });
});

describe("generateProgramming: leaving a feature", () => {
  const office = sitcom("office");
  const parks = sitcom("parks");
  const evenings = programmingRule("evenings", ["christmas"], {
    behavior: "feature",
    conditions: { window: EVENINGS },
  });

  it("never continues the turn a feature interrupted", () => {
    const { blocks, entries } = generated(
      generateProgramming(
        options([office, parks, CHRISTMAS], [evenings], {
          startsAt: utc("2026-12-04T17:15:00Z"),
          through: utc("2026-12-05T01:00:00Z"),
        }),
      ),
    );

    const interrupted = blocks[0];
    const after = entries.find(
      (entry) => entry.startsAt >= utc("2026-12-04T23:00:00Z"),
    );
    expect(after?.programmingBlockId).not.toBe(interrupted?.id);
    const resumedBlock = blocks.find(
      ({ id }) => id === after?.programmingBlockId,
    );
    expect(resumedBlock?.checkpoint.activeContext).toBe("default");
    // The interrupted source was served; the round's other source takes over.
    expect(resumedBlock?.assignmentId).not.toBe(interrupted?.assignmentId);
    expect(resumedBlock?.roundNumber).toBe(interrupted?.roundNumber);
  });

  it("resumes a lower feature's round once a higher one ends", () => {
    const halloween = collectionAssignment(
      "halloween",
      "c-halloween",
      items("halloween", 10, 60),
      { participation: "rule_only", ordinary: { kind: "programs", count: 1 } },
    );
    const extra = collectionAssignment(
      "extra",
      "c-extra",
      items("extra", 10, 60),
      {
        participation: "rule_only",
        ordinary: { kind: "programs", count: 1 },
      },
    );
    const wide = programmingRule("wide", ["christmas", "extra"], {
      behavior: "feature",
      conditions: { window: EVENINGS },
    });
    const short = programmingRule("short", ["halloween"], {
      behavior: "feature",
      priority: 5,
      conditions: { window: { startMinute: 19 * 60, endMinute: 20 * 60 } },
    });

    const { blocks } = generated(
      generateProgramming(
        options([office, CHRISTMAS, extra, halloween], [wide, short], {
          startsAt: utc("2026-12-04T18:00:00Z"),
          through: utc("2026-12-04T23:00:00Z"),
        }),
      ),
    );

    const contexts = blocks.map((block) => block.checkpoint.activeContext);
    const shortAt = contexts.indexOf("rule:short");
    expect(shortAt).toBeGreaterThan(0);
    const before = blocks[shortAt - 1];
    const after = blocks
      .slice(shortAt)
      .find((block) => block.checkpoint.activeContext === "rule:wide");
    expect(before?.checkpoint.activeContext).toBe("rule:wide");
    // The wide feature's first round continues, or its next one starts, without a replay.
    expect(after?.roundNumber).toBeGreaterThanOrEqual(before?.roundNumber ?? 0);
    if (after?.roundNumber === before?.roundNumber) {
      expect(after?.assignmentId).not.toBe(before?.assignmentId);
    }
  });
});

describe("generateProgramming: cooldown across rotation contexts", () => {
  const marathonOffice = collectionAssignment(
    "office",
    "c-office",
    items("office", 40, 30),
    {
      ordinary: { kind: "programs", count: 2 },
      marathon: { kind: "programs", count: 4 },
    },
  );
  const parks = sitcom("parks");
  const evenings = programmingRule("evenings", ["christmas"], {
    behavior: "feature",
    conditions: { window: EVENINGS },
  });

  // The last feature turn of the evening, with the default round suspended
  // holding office's reserved opportunity, and cooldown as `sinceMarathon`.
  function featureTurn(sinceMarathon: number | null): LatestTurn {
    const checkpoint: RotationCheckpoint = {
      activeContext: "rule:evenings",
      contexts: {
        default: {
          roundNumber: 3,
          pending: ["office", "parks"],
          served: [],
          skipped: [],
          unservedRemoved: [],
          marathonOpportunity: { assignmentId: "office", started: false },
          roundCommittedProgram: false,
        },
        "rule:evenings": {
          roundNumber: 2,
          pending: ["christmas"],
          served: [],
          skipped: [],
          unservedRemoved: [],
          marathonOpportunity: null,
          roundCommittedProgram: false,
        },
      },
      lastAiredAssignmentId: "christmas",
      nextMemberPositions: {},
      ordinaryRoundsSinceMarathon: sinceMarathon,
      rebuildCount: 0,
    };
    return {
      block: {
        id: "feature-turn",
        assignmentId: "christmas",
        source: {
          kind: "collection",
          mediaCollectionId: "c-christmas",
          playbackMode: "chronological",
        },
        roundNumber: 2,
        turnIndex: 0,
        startsAt: utc("2026-12-04T21:20:00Z"),
        size: { kind: "programs", value: 1 },
        marathon: false,
        winningRuleId: "evenings",
        settingOrigins: { ordinary: "assignment", marathon: "assignment" },
        endedByEdit: false,
        checkpoint,
      },
      airedPrograms: 1,
      airedMs: 100 * MINUTE_MS,
    };
  }

  it.each([
    [null, true],
    [3, true],
    [0, false],
  ])(
    "starts a suspended round's reserved marathon on resuming only if cooldown permits (since %s)",
    (sinceMarathon, marathon) => {
      const { blocks } = generated(
        generateProgramming(
          options([marathonOffice, parks, CHRISTMAS], [evenings], {
            marathons: { chancePercent: 100, minOrdinaryRounds: 2 },
            latestTurn: featureTurn(sinceMarathon),
            startsAt: utc("2026-12-04T23:00:00Z"),
            through: utc("2026-12-05T01:00:00Z"),
          }),
        ),
      );

      expect(blocks[0]).toMatchObject({
        assignmentId: "office",
        roundNumber: 3,
        marathon,
      });
    },
  );

  // Office's last turn of default round 3, starting at 16:00 with cooldown
  // at `sinceMarathon`, just before the evening feature.
  function lastDefaultTurn(sinceMarathon: number): LatestTurn {
    return {
      block: {
        id: "office-turn",
        assignmentId: "office",
        source: {
          kind: "collection",
          mediaCollectionId: "c-office",
          playbackMode: "chronological",
        },
        roundNumber: 3,
        turnIndex: 1,
        startsAt: utc("2026-12-04T17:00:00Z"),
        size: { kind: "programs", value: 2 },
        marathon: false,
        winningRuleId: null,
        settingOrigins: { ordinary: "assignment", marathon: "assignment" },
        endedByEdit: false,
        checkpoint: {
          activeContext: "default",
          contexts: {
            default: {
              roundNumber: 3,
              pending: ["office"],
              served: ["parks"],
              skipped: [],
              unservedRemoved: [],
              marathonOpportunity: null,
              roundCommittedProgram: true,
            },
          },
          lastAiredAssignmentId: "parks",
          nextMemberPositions: {},
          ordinaryRoundsSinceMarathon: sinceMarathon,
          rebuildCount: 0,
        },
      },
      airedPrograms: 2,
      airedMs: 60 * MINUTE_MS,
    };
  }

  it("never credits a round that completed before a feature's marathon to the cooldown after it", () => {
    const untilNine = programmingRule("evenings", ["christmas"], {
      behavior: "feature",
      conditions: { window: { startMinute: 18 * 60, endMinute: 21 * 60 } },
    });
    const marathonChristmas = {
      ...CHRISTMAS,
      marathon: { kind: "programs", count: 2 },
    } as const;

    const { blocks } = generated(
      generateProgramming(
        options([marathonOffice, parks, marathonChristmas], [untilNine], {
          marathons: { chancePercent: 100, minOrdinaryRounds: 2 },
          latestTurn: lastDefaultTurn(2),
          startsAt: utc("2026-12-04T18:00:00Z"),
          through: utc("2026-12-05T03:00:00Z"),
        }),
      ),
    );

    // Round 3 completed before the 18:00 marathon, and no round completes
    // after it before default rotation resumes at 21:20.
    expect(blocks[0]).toMatchObject({
      assignmentId: "christmas",
      marathon: true,
    });
    const resumed = blocks.find(
      (block) => block.checkpoint.activeContext === "default",
    );
    expect(resumed).toMatchObject({ roundNumber: 4, marathon: false });
    expect(resumed?.checkpoint.ordinaryRoundsSinceMarathon).toBe(0);
    expect(
      resumed?.checkpoint.contexts.default?.marathonOpportunity,
    ).toBeNull();
  });

  it("lets rounds completed in a feature context satisfy the default cooldown", () => {
    const run = (rules: ProgrammingRule[]) =>
      generated(
        generateProgramming(
          options([marathonOffice, parks, CHRISTMAS], rules, {
            marathons: { chancePercent: 100, minOrdinaryRounds: 2 },
            // A marathon just ended default round 3.
            latestTurn: lastDefaultTurn(0),
            startsAt: utc("2026-12-04T18:00:00Z"),
            through: utc("2026-12-05T03:00:00Z"),
          }),
        ),
      ).blocks.find((block) => block.checkpoint.activeContext === "default");

    // Round 3 and one one-film feature round complete: round 4 may hold one.
    const oneFilm = programmingRule("evenings", ["christmas"], {
      behavior: "feature",
      conditions: { window: { startMinute: 18 * 60, endMinute: 19 * 60 } },
    });
    expect(
      run([oneFilm])?.checkpoint.contexts.default?.marathonOpportunity,
    ).not.toBeNull();
    // Without the feature only round 3 has completed.
    expect(
      run([])?.checkpoint.contexts.default?.marathonOpportunity,
    ).toBeNull();
  });

  it("counts rounds completed in any context toward one cooldown", () => {
    const { blocks } = generated(
      generateProgramming(
        options([marathonOffice, parks, CHRISTMAS], [evenings], {
          marathons: { chancePercent: 100, minOrdinaryRounds: 2 },
          startsAt: utc("2026-12-04T00:00:00Z"),
          through: utc("2026-12-12T00:00:00Z"),
        }),
      ),
    );

    // Between two marathons, at least two ordinary rounds complete, in
    // whichever contexts they ran.
    const marathons = blocks
      .map((block, index) => ({ block, index }))
      .filter(({ block }) => block.marathon);
    expect(marathons.length).toBeGreaterThan(1);
    for (const [earlier, later] of marathons
      .slice(1)
      .map((m, i) => [marathons[i], m])) {
      const completed = completedRoundsBetween(
        blocks,
        earlier?.index ?? 0,
        later?.index ?? 0,
      );
      expect(completed).toBeGreaterThanOrEqual(2);
    }
  });
});

/** The latest default-context block before `block`. */
function lastDefaultBlockBefore(
  blocks: readonly GeneratedBlock[],
  block: GeneratedBlock,
): GeneratedBlock | undefined {
  return blocks
    .slice(0, blocks.indexOf(block))
    .filter((earlier) => earlier.checkpoint.activeContext === "default")
    .at(-1);
}

/**
 * Counts ordinary rounds, in any context, that complete after the marathon
 * at `from` starts and before the marathon at `to` does. A round completes
 * when its last turn starts, the turn that alone is still pending, and
 * counts only if none of its turns was a marathon (programming spec 0004).
 */
function completedRoundsBetween(
  blocks: readonly GeneratedBlock[],
  from: number,
  to: number,
): number {
  const round = (block: GeneratedBlock) =>
    `${block.checkpoint.activeContext}#${block.roundNumber}`;
  const marathonRounds = new Set(
    blocks.filter((block) => block.marathon).map(round),
  );
  return blocks.filter(
    (block, index) =>
      index > from &&
      index < to &&
      block.checkpoint.contexts[block.checkpoint.activeContext]?.pending
        .length === 1 &&
      !marathonRounds.has(round(block)),
  ).length;
}
