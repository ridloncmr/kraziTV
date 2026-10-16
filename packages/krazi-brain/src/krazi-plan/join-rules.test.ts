import { describe, expect, it } from "vitest";

import {
  collectionAssignment,
  generateInChunks,
  programmingRule,
  sequentialBlockIds,
} from "../testing/programming-assignments.js";
import { scheduleMedia } from "../testing/schedule-media.js";
import type { CalendarConditions } from "../calendar/contracts.js";
import type { ScheduleMedia } from "../schedule/contracts.js";
import type {
  GeneratedBlock,
  ProgrammingAssignment,
  ProgrammingRule,
} from "./contracts.js";
import {
  generateProgramming,
  type GenerateProgrammingOptions,
} from "./generate-programming.js";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
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

// A sitcom of 30-minute episodes, two a turn.
function sitcom(id: string): ProgrammingAssignment {
  return collectionAssignment(id, `c-${id}`, items(id, 12, 30), {
    ordinary: { kind: "programs", count: 2 },
  });
}

// A rule-only movie collection, one 150-minute film a turn.
function movies(id: string): ProgrammingAssignment {
  return collectionAssignment(id, `c-${id}`, items(id, 12, 150), {
    participation: "rule_only",
    ordinary: { kind: "programs", count: 1 },
  });
}

const DEFAULTS = ["office", "parks", "scrubs"].map(sitcom);
const CHRISTMAS = movies("christmas");
const WINTER = movies("winter");
const COMEDY = movies("comedy");

// A join rule under the given conditions and priority.
function joinRule(
  id: string,
  sources: string[],
  conditions: Partial<CalendarConditions>,
  priority = 0,
): ProgrammingRule {
  return programmingRule(id, sources, { conditions, priority });
}

const DECEMBER = joinRule("december", ["christmas"], {
  dates: { kind: "annual", startMonthDay: "12-01", endMonthDay: "12-31" },
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
    startsAt: utc("2026-11-29T00:00:00Z"),
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

// Each block's assignment, grouped by its context and round.
function rounds(blocks: readonly GeneratedBlock[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const block of blocks) {
    const key = `${block.checkpoint.activeContext}#${block.roundNumber}`;
    grouped.set(key, [...(grouped.get(key) ?? []), block.assignmentId ?? ""]);
  }
  return grouped;
}

describe("generateProgramming: join rules", () => {
  it("rotates rule-only Christmas movies with the defaults through December only", () => {
    const { blocks, entries } = generated(
      generateProgramming(options([...DEFAULTS, CHRISTMAS], [DECEMBER])),
    );

    const christmas = entries.filter(
      (entry) => entry.mediaCollectionId === "c-christmas",
    );
    expect(christmas.length).toBeGreaterThan(20);
    for (const entry of christmas) {
      expect(entry.startsAt).toBeGreaterThanOrEqual(
        utc("2026-12-01T00:00:00Z"),
      );
      expect(entry.startsAt).toBeLessThan(utc("2027-01-01T00:00:00Z"));
    }
    // November and January rotate only the defaults.
    const outside = blocks.filter(
      (block) =>
        block.startsAt < utc("2026-12-01T00:00:00Z") ||
        block.startsAt >= utc("2027-01-01T03:00:00Z"),
    );
    expect(new Set(outside.map((block) => block.assignmentId))).toEqual(
      new Set(["office", "parks", "scrubs"]),
    );
    // A December block names the rule that won it; others name none.
    expect(
      blocks.find((block) => block.assignmentId === "christmas")?.winningRuleId,
    ).toBe("december");
    expect(blocks[0]?.winningRuleId).toBeNull();
  });

  it("gives every source at most one turn a round, even across leaving and rejoining", () => {
    // Long rounds and a short daily window make sources leave and rejoin mid-round.
    const longDefaults = ["office", "parks", "scrubs", "frasier"].map((id) =>
      collectionAssignment(id, `c-${id}`, items(id, 40, 60), {
        ordinary: { kind: "programs", count: 6 },
      }),
    );
    const evenings = joinRule("evenings", ["christmas"], {
      window: { startMinute: 18 * 60, endMinute: 19 * 60 },
    });

    const { blocks } = generated(
      generateProgramming(
        options([...longDefaults, CHRISTMAS], [evenings], {
          through: utc("2026-12-29T00:00:00Z"),
        }),
      ),
    );

    for (const turns of rounds(blocks).values()) {
      expect(new Set(turns).size).toBe(turns.length);
    }
    expect(blocks.some((block) => block.assignmentId === "christmas")).toBe(
      true,
    );
  });

  it("gives a source referenced by both the defaults and the winning rule one turn a round", () => {
    const both = joinRule("both", ["office", "christmas"], {});

    const { blocks } = generated(
      generateProgramming(options([...DEFAULTS, CHRISTMAS], [both])),
    );

    const complete = [...rounds(blocks).values()].slice(0, -1);
    expect(complete.length).toBeGreaterThan(10);
    for (const turns of complete) {
      expect([...turns].sort()).toEqual([
        "christmas",
        "office",
        "parks",
        "scrubs",
      ]);
    }
  });

  it("joins only the winning rule's sources when December, Winter, and Friday rules overlap", () => {
    const rules = [
      joinRule("december", ["christmas"], DECEMBER.conditions, 3),
      joinRule(
        "winter",
        ["winter"],
        {
          dates: {
            kind: "annual",
            startMonthDay: "11-15",
            endMonthDay: "02-15",
          },
        },
        2,
      ),
      joinRule("fridays", ["comedy"], { weekdays: [5] }, 1),
    ];
    // 2026-12-04 is a Friday in December and in winter.
    const friday = {
      startsAt: utc("2026-12-04T00:00:00Z"),
      through: utc("2026-12-05T00:00:00Z"),
    };

    const separate = generated(
      generateProgramming(
        options([...DEFAULTS, CHRISTMAS, WINTER, COMEDY], rules, friday),
      ),
    );
    expect(new Set(separate.blocks.map((block) => block.assignmentId))).toEqual(
      new Set(["office", "parks", "scrubs", "christmas"]),
    );

    const combined = generated(
      generateProgramming(
        options(
          [...DEFAULTS, CHRISTMAS, WINTER, COMEDY],
          [joinRule("holidays", ["christmas", "winter", "comedy"], {})],
          friday,
        ),
      ),
    );
    expect(new Set(combined.blocks.map((block) => block.assignmentId))).toEqual(
      new Set(["office", "parks", "scrubs", "christmas", "winter", "comedy"]),
    );
  });

  it("falls through a winning rule with no usable source to the next rule, then to defaults", () => {
    const empty = collectionAssignment("empty", "c-empty", [], {
      participation: "rule_only",
    });
    const rules = [
      joinRule("broken", ["empty"], {}, 2),
      joinRule("december", ["christmas"], DECEMBER.conditions, 1),
    ];

    const { blocks, ruleSkips } = generated(
      generateProgramming(options([...DEFAULTS, CHRISTMAS, empty], rules)),
    );

    const winners = new Set(blocks.map((block) => block.winningRuleId));
    expect(winners).toEqual(new Set([null, "december"]));
    expect(blocks.some((block) => block.assignmentId === "empty")).toBe(false);
    // Every block names the rule passed over before its decision, once.
    expect(ruleSkips).toHaveLength(blocks.length);
    for (const block of blocks) {
      expect(ruleSkips.filter((skip) => skip.blockId === block.id)).toEqual([
        { blockId: block.id, ruleId: "broken", reason: "no_usable_source" },
      ]);
    }
  });

  it("finishes a movie that runs past its window, then follows current eligibility", () => {
    const evenings = joinRule("evenings", ["christmas"], {
      window: { startMinute: 18 * 60, endMinute: 20 * 60 },
    });
    const twoFilms = { ...CHRISTMAS, ordinary: { kind: "programs", count: 2 } };

    const { entries } = generated(
      generateProgramming(
        options(
          [...DEFAULTS, twoFilms] as ProgrammingAssignment[],
          [evenings],
          {
            through: utc("2026-12-15T00:00:00Z"),
          },
        ),
      ),
    );

    const films = entries.filter(
      (entry) => entry.mediaCollectionId === "c-christmas",
    );
    expect(films.length).toBeGreaterThan(3);
    for (const film of films) {
      const minute = (film.startsAt % DAY_MS) / MINUTE_MS;
      // Each film starts inside the window and finishes after it ends.
      expect(minute).toBeGreaterThanOrEqual(18 * 60);
      expect(minute).toBeLessThan(20 * 60);
      expect(film.endsAt % DAY_MS).toBeGreaterThan(20 * HOUR_MS);
      // So the turn's second film never airs; a default follows.
      const next = entries.find((entry) => entry.startsAt === film.endsAt);
      expect(next?.mediaCollectionId).not.toBe("c-christmas");
    }
  });

  it("keeps a default source's stretch running when a join ends", () => {
    const evenings = joinRule("evenings", ["christmas"], {
      window: { startMinute: 18 * 60, endMinute: 20 * 60 },
    });

    const { blocks, entries } = generated(
      generateProgramming(options([...DEFAULTS, CHRISTMAS], [evenings])),
    );

    for (const block of blocks.slice(0, -1)) {
      if (block.assignmentId === "christmas") continue;
      expect(
        entries.filter((entry) => entry.programmingBlockId === block.id),
      ).toHaveLength(2);
    }
  });

  it.each([1, 2, 7])(
    "stores the same checkpoints in chunks of %i while a source leaves and rejoins mid-round",
    (chunkSize) => {
      // Turns of 150 minutes drift across the evening join, which often
      // closes while Christmas is still owed a turn in the round.
      const drifting = ["office", "parks", "scrubs", "frasier", "cheers"].map(
        (id) =>
          collectionAssignment(id, `c-${id}`, items(id, 40, 50), {
            ordinary: { kind: "programs", count: 3 },
          }),
      );
      const evenings = joinRule("evenings", ["christmas"], {
        window: { startMinute: 18 * 60, endMinute: 20 * 60 },
      });
      const run = (size: number) =>
        generateInChunks(
          {
            ...options([...drifting, CHRISTMAS], [evenings], {
              through: utc("2026-12-08T00:00:00Z"),
            }),
            createBlockId: sequentialBlockIds(),
          },
          size,
        );

      const whole = run(100_000);
      const chunked = run(chunkSize);

      // The scenario really does remember a removed source and recover it.
      expect(
        whole.blocks.some(
          (block) =>
            (block.checkpoint.contexts.default?.unservedRemoved.length ?? 0) >
            0,
        ),
      ).toBe(true);
      expect(chunked).toEqual(whole);
      expect(
        chunked.blocks.map((block) => JSON.stringify(block.checkpoint)),
      ).toEqual(whole.blocks.map((block) => JSON.stringify(block.checkpoint)));
    },
  );

  it("stops coverage where nothing can air until a rule applies again", () => {
    const fridayEvenings = joinRule("fridays", ["christmas"], {
      weekdays: [5],
      window: { startMinute: 18 * 60, endMinute: 23 * 60 },
    });
    const friday6pm = utc("2026-12-04T18:00:00Z");

    const result = generated(
      generateProgramming(
        options([CHRISTMAS], [fridayEvenings], { startsAt: friday6pm }),
      ),
    );

    // Two whole films air from 18:00; none may start at 23:00.
    expect(result.entries.map((entry) => entry.startsAt)).toEqual([
      friday6pm,
      friday6pm + 150 * MINUTE_MS,
    ]);
    expect(result.generatedThrough).toBe(friday6pm + 300 * MINUTE_MS);
    expect(
      generateProgramming(
        options([CHRISTMAS], [fridayEvenings], {
          startsAt: result.generatedThrough,
        }),
      ),
    ).toEqual({ kind: "unschedulable", reason: "no_schedulable_media" });
  });

  it.each([1, 3, 50])(
    "writes identical blocks and entries across a month boundary in chunks of %i",
    (chunkSize) => {
      const evenings = joinRule("evenings", ["christmas"], {
        dates: DECEMBER.conditions.dates,
        window: { startMinute: 18 * 60, endMinute: 22 * 60 },
      });
      const run = (size: number) =>
        generateInChunks(
          {
            ...options([...DEFAULTS, CHRISTMAS], [DECEMBER, evenings], {
              startsAt: utc("2026-11-29T12:00:00Z"),
              through: utc("2026-12-03T00:00:00Z"),
            }),
            createBlockId: sequentialBlockIds(),
          },
          size,
        );

      expect(run(chunkSize)).toEqual(run(100_000));
    },
  );

  it("evaluates rules in the programming timezone", () => {
    const evenings = joinRule("evenings", ["christmas"], {
      window: { startMinute: 18 * 60, endMinute: 20 * 60 },
    });

    const { entries } = generated(
      generateProgramming(
        options([...DEFAULTS, CHRISTMAS], [evenings], {
          timeZone: "America/New_York",
          through: utc("2026-12-10T00:00:00Z"),
        }),
      ),
    );

    const films = entries.filter(
      (entry) => entry.mediaCollectionId === "c-christmas",
    );
    expect(films.length).toBeGreaterThan(0);
    for (const film of films) {
      // 18:00-20:00 EST is 23:00-01:00 UTC.
      const minute = (film.startsAt % DAY_MS) / MINUTE_MS;
      expect(minute >= 23 * 60 || minute < 60).toBe(true);
    }
  });
});
