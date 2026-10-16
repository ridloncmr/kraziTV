import { describe, expect, it } from "vitest";

import {
  collectionAssignment,
  sequentialBlockIds,
} from "../../testing/programming-assignments.js";
import { scheduleMedia } from "../../testing/schedule-media.js";
import type { PlaybackMode, ScheduleMedia } from "../../schedule/contracts.js";
import type { ProgrammingAssignment, StretchSetting } from "../contracts.js";
import {
  generateProgramming,
  type GenerateProgrammingOptions,
} from "../generate-programming.js";
import { findStretchProblem } from "./stretch-settings.js";

// 2026-01-01T00:00:00.000Z as a UTC millisecond schedule anchor.
const STARTS_AT = 1_767_225_600_000;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

// `count` programs of `minutes` each, named `<prefix>1`, `<prefix>2`, ...
function programs(prefix: string, count: number, minutes: number) {
  return Array.from({ length: count }, (_, index) =>
    scheduleMedia(`${prefix}${index + 1}`, { durationMs: minutes * MINUTE_MS }),
  );
}

function sitcom(
  ordinary: StretchSetting,
  members: ScheduleMedia[] = programs("e", 7, 22),
  playbackMode: PlaybackMode = "chronological",
) {
  return collectionAssignment("sitcom", "c-sitcom", members, {
    ordinary,
    playbackMode,
  });
}

const MOVIES = collectionAssignment(
  "movies",
  "c-movies",
  programs("m", 5, 120),
  {
    ordinary: { kind: "programs", count: 1 },
  },
);

function options(
  assignments: readonly ProgrammingAssignment[],
  overrides: Partial<GenerateProgrammingOptions> = {},
): GenerateProgrammingOptions {
  return {
    channelSeed: 0x5d4886b3,
    programmingSeed: 0x1234abcd,
    rebuildCount: 0,
    marathons: { chancePercent: 0, minOrdinaryRounds: 2 },
    assignments,
    rules: [],
    timeZone: "UTC",
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

// Each of an assignment's turns as [resolved size, programs, airtime minutes].
function turns(result: ReturnType<typeof generated>, assignmentId = "sitcom") {
  return result.blocks
    .filter((block) => block.assignmentId === assignmentId)
    .slice(0, -1) // the last turn may be cut off at `through`
    .map((block) => {
      const aired = result.entries.filter(
        (entry) => entry.programmingBlockId === block.id,
      );
      return {
        size: block.size,
        programs: aired.length,
        minutes:
          aired.reduce((total, entry) => total + entry.durationMs, 0) /
          MINUTE_MS,
      };
    });
}

describe("generateProgramming: airtime stretches", () => {
  it("airs three 22-minute episodes (66 minutes) for a 60-minute target, every turn", () => {
    const result = generated(
      generateProgramming(
        options([sitcom({ kind: "airtime", minutes: 60 }), MOVIES]),
      ),
    );

    const sitcomTurns = turns(result);
    expect(sitcomTurns.length).toBeGreaterThan(3);
    for (const turn of sitcomTurns) {
      expect(turn).toEqual({
        size: { kind: "airtime", value: 60 },
        programs: 3,
        minutes: 66,
      });
    }
  });

  it("ends a turn on a program that meets the target exactly, and airs a long movie whole", () => {
    const hour = generated(
      generateProgramming(
        options([
          sitcom({ kind: "airtime", minutes: 60 }, programs("h", 4, 60)),
          MOVIES,
        ]),
      ),
    );
    const movie = generated(
      generateProgramming(
        options([
          sitcom({ kind: "airtime", minutes: 60 }, programs("f", 4, 120)),
          MOVIES,
        ]),
      ),
    );

    expect(turns(hour).every((turn) => turn.programs === 1)).toBe(true);
    expect(turns(movie)[0]).toMatchObject({ programs: 1, minutes: 120 });
  });

  it("resolves a variable range once per turn, within its inclusive bounds", () => {
    const result = generated(
      generateProgramming(
        options(
          [
            sitcom({ kind: "airtime_range", minMinutes: 30, maxMinutes: 90 }),
            MOVIES,
          ],
          { through: STARTS_AT + 7 * DAY_MS },
        ),
      ),
    );

    const sizes = turns(result).map((turn) => turn.size?.value ?? 0);
    expect(sizes.every((minutes) => minutes >= 30 && minutes <= 90)).toBe(true);
    expect(new Set(sizes).size).toBeGreaterThan(3);
    for (const turn of turns(result)) {
      // Each turn ends on the first program that reaches its own target.
      expect(turn.minutes).toBeGreaterThanOrEqual(turn.size?.value ?? 0);
      expect(turn.minutes - 22).toBeLessThan(turn.size?.value ?? 0);
    }
  });

  it("treats equal range bounds as a fixed target", () => {
    const result = generated(
      generateProgramming(
        options([
          sitcom({ kind: "airtime_range", minMinutes: 45, maxMinutes: 45 }),
          MOVIES,
        ]),
      ),
    );

    for (const turn of turns(result)) {
      expect(turn).toMatchObject({
        size: { kind: "airtime", value: 45 },
        programs: 3,
      });
    }
  });

  it("never lets size decisions change collection random selection", () => {
    const randomSitcom = (ordinary: StretchSetting) =>
      sitcom(ordinary, programs("r", 9, 22), "random");
    const picks = (programmingSeed: number, ordinary: StretchSetting) =>
      generated(
        generateProgramming(
          options([randomSitcom(ordinary), MOVIES], { programmingSeed }),
        ),
      )
        .entries.filter((entry) => entry.mediaCollectionId === "c-sitcom")
        .map((entry) => entry.mediaItemId)
        .slice(0, 20);

    const range: StretchSetting = {
      kind: "airtime_range",
      minMinutes: 22,
      maxMinutes: 110,
    };
    expect(picks(1, range)).toEqual(picks(2, range));
    expect(picks(1, range)).toEqual(picks(1, { kind: "programs", count: 2 }));
  });
});

describe("findStretchProblem", () => {
  it.each([
    [{ kind: "programs", count: 3 }],
    [{ kind: "airtime", minutes: 60 }],
    [{ kind: "airtime_range", minMinutes: 60, maxMinutes: 60 }],
    [{ kind: "airtime_range", minMinutes: 60, maxMinutes: 120 }],
  ] as const)("accepts %o", (stretch) => {
    expect(findStretchProblem(stretch)).toBeNull();
  });

  it.each([
    [{ kind: "programs", count: 0 }, "count must be a positive integer"],
    [{ kind: "programs", count: 1.5 }, "count must be a positive integer"],
    [{ kind: "airtime", minutes: -5 }, "minutes must be a positive integer"],
    [
      { kind: "airtime_range", minMinutes: 0, maxMinutes: 30 },
      "minMinutes must be a positive integer",
    ],
    [
      { kind: "airtime_range", minMinutes: 30, maxMinutes: 29.5 },
      "maxMinutes must be a positive integer",
    ],
    [
      { kind: "airtime_range", minMinutes: 90, maxMinutes: 60 },
      "maxMinutes must be at least minMinutes",
    ],
  ] as const)("refuses %o", (stretch, problem) => {
    expect(findStretchProblem(stretch)).toBe(problem);
  });
});
