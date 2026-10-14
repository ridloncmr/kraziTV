import { describe, expect, it } from "vitest";

import {
  collectionAssignment,
  generateInChunks,
  latestTurn,
  sequentialBlockIds,
} from "../testing/programming-assignments.js";
import { scheduleMedia } from "../testing/schedule-media.js";
import type { ScheduleMedia } from "../schedule/contracts.js";
import type { GeneratedBlock, ProgrammingAssignment } from "./contracts.js";
import { isUsableAssignment } from "./rotation.js";
import {
  generateProgramming,
  type GenerateProgrammingOptions,
} from "./generate-programming.js";

// 2026-01-01T00:00:00.000Z as a UTC millisecond schedule anchor.
const STARTS_AT = 1_767_225_600_000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// One collection of `count` 22-minute episodes named `<prefix>1`, `<prefix>2`, ...
function episodes(prefix: string, count: number): ScheduleMedia[] {
  return Array.from({ length: count }, (_, index) =>
    scheduleMedia(`${prefix}${index + 1}`, { durationMs: 22 * 60_000 }),
  );
}

// Four sources in saved order, two programs a turn each.
const FOUR: ProgrammingAssignment[] = [
  "office",
  "parks",
  "scrubs",
  "frasier",
].map((id) =>
  collectionAssignment(id, `c-${id}`, episodes(id, 7), {
    ordinary: { kind: "programs", count: 2 },
  }),
);

function options(
  assignments: readonly ProgrammingAssignment[],
  overrides: Partial<GenerateProgrammingOptions> = {},
): GenerateProgrammingOptions {
  return {
    channelSeed: 0x5d4886b3,
    programmingSeed: 0x1234abcd,
    rebuildCount: 0,
    assignments,
    latestTurn: undefined,
    progress: [],
    startsAt: STARTS_AT,
    through: STARTS_AT + 3 * DAY_MS,
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

// Groups block assignments by round, dropping the last, possibly unfinished, round.
function completedRounds(blocks: readonly GeneratedBlock[]): string[][] {
  const rounds = new Map<number, string[]>();
  for (const block of blocks) {
    rounds.set(block.roundNumber, [
      ...(rounds.get(block.roundNumber) ?? []),
      block.assignmentId ?? "",
    ]);
  }
  return [...rounds.values()].slice(0, -1);
}

describe("generateProgramming: shuffled rounds", () => {
  it("gives each usable assignment exactly one turn per round", () => {
    const { blocks } = generated(generateProgramming(options(FOUR)));

    const rounds = completedRounds(blocks);
    expect(rounds.length).toBeGreaterThan(10);
    for (const round of rounds) {
      expect([...round].sort()).toEqual([
        "frasier",
        "office",
        "parks",
        "scrubs",
      ]);
    }
    expect(blocks.map((block) => block.turnIndex).slice(0, 4)).toEqual([
      0, 1, 2, 3,
    ]);
  });

  it("shuffles rounds reproducibly from the programming seed, not saved order", () => {
    const orders = (programmingSeed: number) =>
      completedRounds(
        generated(generateProgramming(options(FOUR, { programmingSeed })))
          .blocks,
      ).map((round) => round.join());

    const first = orders(0x1234abcd);
    expect(orders(0x1234abcd)).toEqual(first);
    expect(new Set(first).size).toBeGreaterThan(1);
    expect(
      first.every((order) => order === FOUR.map(({ id }) => id).join()),
    ).toBe(false);
    expect(orders(0x0badf00d)).not.toEqual(first);
  });

  it("never repeats an assignment back to back while another is usable", () => {
    for (const programmingSeed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { blocks } = generated(
        generateProgramming(options(FOUR, { programmingSeed })),
      );

      for (let index = 1; index < blocks.length; index += 1) {
        expect(blocks[index]?.assignmentId).not.toBe(
          blocks[index - 1]?.assignmentId,
        );
      }
    }
  });

  it("loops one assignment forever, repeating it when it is the only source", () => {
    const { blocks, entries } = generated(
      generateProgramming(options(FOUR.slice(0, 1))),
    );

    expect(new Set(blocks.map((block) => block.assignmentId))).toEqual(
      new Set(["office"]),
    );
    expect(entries.at(-1)?.endsAt).toBeGreaterThanOrEqual(
      STARTS_AT + 3 * DAY_MS,
    );
  });

  it("resumes each collection's own order after the others air", () => {
    const { entries } = generated(generateProgramming(options(FOUR)));

    for (const { id } of FOUR) {
      const aired = entries
        .filter((entry) => entry.mediaCollectionId === `c-${id}`)
        .map((entry) => entry.mediaItemId);
      expect(aired.slice(0, 9)).toEqual(
        [1, 2, 3, 4, 5, 6, 7, 1, 2].map((episode) => `${id}${episode}`),
      );
    }
  });

  it.each([1, 3, 7, 50])(
    "produces identical blocks and entries for a week in chunks of %i",
    (chunkSize) => {
      const run = (size: number) =>
        generateInChunks(
          {
            ...options(FOUR, { through: STARTS_AT + 7 * DAY_MS }),
            createBlockId: sequentialBlockIds(),
          },
          size,
        );

      expect(run(chunkSize)).toEqual(run(100_000));
    },
  );

  it("starts different decisions after a fresh rebuild advances the count", () => {
    const order = (rebuildCount: number) =>
      completedRounds(
        generated(generateProgramming(options(FOUR, { rebuildCount }))).blocks,
      )
        .slice(0, 6)
        .map((round) => round.join());

    expect(order(1)).not.toEqual(order(0));
  });
});

describe("generateProgramming: unusable assignments", () => {
  const EMPTY = collectionAssignment("empty", "c-empty", []);

  it("skips an unusable assignment with its reason, without consuming progress", () => {
    const result = generated(
      generateProgramming(options([...FOUR.slice(0, 2), EMPTY])),
    );

    expect(new Set(result.blocks.map((block) => block.assignmentId))).toEqual(
      new Set(["office", "parks"]),
    );
    expect(result.blocks[0]?.checkpoint.skipped).toEqual(["empty"]);
    expect(result.skips[0]).toEqual({
      assignmentId: "empty",
      roundNumber: 1,
      reasons: ["empty_collection"],
    });
    expect(
      result.progress.map((entry) => entry.mediaCollectionId).sort(),
    ).toEqual(["c-office", "c-parks"]);
  });

  it("reconsiders a skipped assignment in the next round once it is usable", () => {
    const first = generated(
      generateProgramming(
        options([...FOUR.slice(0, 2), EMPTY], { maxEntries: 2 }),
      ),
    );
    const filled = collectionAssignment("empty", "c-empty", episodes("new", 3));

    const second = generated(
      generateProgramming(
        options([...FOUR.slice(0, 2), filled], {
          startsAt: first.generatedThrough,
          nextSequenceNumber: first.nextSequenceNumber,
          latestTurn: latestTurn(first),
          progress: first.progress,
          createBlockId: sequentialBlockIds("later"),
          maxEntries: 20,
        }),
      ),
    );

    // Round one finishes without it; round two includes it.
    const roundOf = (id: string) =>
      second.blocks
        .filter((block) => block.assignmentId === id)
        .map((block) => block.roundNumber);
    expect(roundOf("empty")[0]).toBe(2);
    expect(second.blocks[0]?.roundNumber).toBe(1);
  });

  it("reports a channel whose assignments are all unusable, and generates nothing", () => {
    expect(
      generateProgramming(
        options([
          EMPTY,
          collectionAssignment("gone", "c-gone", [
            scheduleMedia("x", { status: "missing" }),
          ]),
        ]),
      ),
    ).toEqual({ kind: "unschedulable", reason: "no_schedulable_media" });
  });
});

describe("isUsableAssignment", () => {
  it("is true while any member is schedulable, false once none is", () => {
    expect(isUsableAssignment(FOUR[0])).toBe(true);
    expect(
      isUsableAssignment(collectionAssignment("empty", "c-empty", [])),
    ).toBe(false);
    expect(
      isUsableAssignment(
        collectionAssignment("gone", "c-gone", [
          scheduleMedia("x", { status: "missing" }),
        ]),
      ),
    ).toBe(false);
  });
});
