import { describe, expect, it } from "vitest";

import {
  collectionAssignment,
  generateInChunks,
  itemAssignment,
  latestTurn,
  sequentialBlockIds,
} from "../testing/programming-assignments.js";
import { scheduleMedia } from "../testing/schedule-media.js";
import { NO_PROGRESS, type ScheduleMedia } from "../schedule/contracts.js";
import { generateScheduleEntries } from "../schedule/generate-schedule-entries.js";
import type { ProgrammingAssignment } from "./contracts.js";
import {
  generateProgramming,
  type GenerateProgrammingOptions,
} from "./generate-programming.js";

// 2026-01-01T00:00:00.000Z as a UTC millisecond schedule anchor.
const STARTS_AT = 1_767_225_600_000;
const HOUR_MS = 60 * 60 * 1000;
const CHANNEL_SEED = 0x5d4886b3;

// Five 22-minute episodes, so turns of three wrap through the collection.
const EPISODES: ScheduleMedia[] = ["e1", "e2", "e3", "e4", "e5"].map((id) =>
  scheduleMedia(id, { durationMs: 22 * 60_000 }),
);

function options(
  assignments: readonly ProgrammingAssignment[],
  overrides: Partial<GenerateProgrammingOptions> = {},
): GenerateProgrammingOptions {
  return {
    channelSeed: CHANNEL_SEED,
    programmingSeed: 0x1234abcd,
    rebuildCount: 0,
    marathons: { chancePercent: 0, minOrdinaryRounds: 2 },
    assignments,
    rules: [],
    timeZone: "UTC",
    latestTurn: undefined,
    progress: [],
    startsAt: STARTS_AT,
    through: STARTS_AT + 24 * HOUR_MS,
    nextSequenceNumber: 0,
    maxEntries: 500,
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

describe("generateProgramming: one assignment", () => {
  it.each(["chronological", "random"] as const)(
    "airs the same %s entries as today's single loop, in turns of three",
    (playbackMode) => {
      const assignment = collectionAssignment("office", "c-office", EPISODES, {
        playbackMode,
      });
      const loop = generateScheduleEntries({
        channelSeed: CHANNEL_SEED,
        source: {
          kind: "collection",
          programmingBlockId: "loop",
          mediaCollectionId: "c-office",
          playbackMode,
          members: EPISODES,
        },
        progress: NO_PROGRESS,
        startsAt: STARTS_AT,
        through: STARTS_AT + 24 * HOUR_MS,
        nextSequenceNumber: 0,
        maxEntries: 500,
      });
      if (loop.kind !== "generated") throw new Error("loop unschedulable");

      const result = generated(generateProgramming(options([assignment])));

      const withoutBlock = ({
        programmingBlockId: _,
        ...entry
      }: (typeof loop.entries)[number]) => entry;
      expect(result.entries.map(withoutBlock)).toEqual(
        loop.entries.map(withoutBlock),
      );
      expect(result.progress).toEqual([
        {
          mediaCollectionId: "c-office",
          playbackMode,
          progress: loop.progress,
        },
      ]);
      const perBlock = result.blocks.map(
        (block) =>
          result.entries.filter(
            (entry) => entry.programmingBlockId === block.id,
          ).length,
      );
      expect(perBlock.slice(0, -1).every((count) => count === 3)).toBe(true);
      expect(perBlock.at(-1)).toBeLessThanOrEqual(3);
    },
  );

  it("records each turn's member, size, timing, and the checkpoint before it", () => {
    const assignment = collectionAssignment("office", "c-office", EPISODES);

    const result = generated(
      generateProgramming(
        options([assignment], { through: STARTS_AT + 2 * HOUR_MS }),
      ),
    );

    expect(result.blocks[0]).toEqual({
      id: "block-1",
      assignmentId: "office",
      source: {
        kind: "collection",
        mediaCollectionId: "c-office",
        playbackMode: "chronological",
      },
      roundNumber: 1,
      turnIndex: 0,
      startsAt: STARTS_AT,
      size: { kind: "programs", value: 3 },
      marathon: false,
      winningRuleId: null,
      endedByEdit: false,
      checkpoint: {
        activeContext: "default",
        contexts: {
          default: {
            roundNumber: 1,
            pending: ["office"],
            served: [],
            skipped: [],
            unservedRemoved: [],
            marathonOpportunity: null,
            roundCommittedProgram: false,
          },
        },
        lastAiredAssignmentId: null,
        nextMemberPositions: { office: 0 },
        ordinaryRoundsSinceMarathon: null,
        rebuildCount: 0,
      },
    });
    expect(result.blocks[1]).toMatchObject({
      roundNumber: 2,
      turnIndex: 0,
      startsAt: STARTS_AT + 66 * 60_000,
      checkpoint: {
        contexts: {
          default: {
            roundNumber: 2,
            pending: ["office"],
            served: [],
            roundCommittedProgram: false,
          },
        },
        lastAiredAssignmentId: "office",
        nextMemberPositions: { office: 0 },
      },
    });
  });

  it.each([1, 2, 3, 7, 500])(
    "produces identical blocks and entries in chunks of %i",
    (chunkSize) => {
      const assignment = collectionAssignment("office", "c-office", EPISODES, {
        playbackMode: "random",
      });
      const run = (size: number) =>
        generateInChunks(
          {
            channelSeed: CHANNEL_SEED,
            programmingSeed: 0x1234abcd,
            rebuildCount: 0,
            marathons: { chancePercent: 0, minOrdinaryRounds: 2 },
            assignments: [assignment],
            rules: [],
            timeZone: "UTC",
            startsAt: STARTS_AT,
            through: STARTS_AT + 24 * HOUR_MS,
            createBlockId: sequentialBlockIds(),
          },
          size,
        );

      expect(run(chunkSize)).toEqual(run(10_000));
    },
  );

  it("continues the latest turn until its size is met", () => {
    const assignment = collectionAssignment("office", "c-office", EPISODES);
    const first = generated(
      generateProgramming(options([assignment], { maxEntries: 1 })),
    );

    const second = generated(
      generateProgramming(
        options([assignment], {
          startsAt: first.generatedThrough,
          nextSequenceNumber: first.nextSequenceNumber,
          latestTurn: latestTurn(first),
          progress: first.progress,
          maxEntries: 3,
          createBlockId: () => "block-2",
        }),
      ),
    );

    expect(
      second.entries.map((entry) => [
        entry.mediaItemId,
        entry.programmingBlockId,
      ]),
    ).toEqual([
      ["e2", "block-1"],
      ["e3", "block-1"],
      ["e4", "block-2"],
    ]);
    expect(second.blocks.map((block) => block.id)).toEqual(["block-2"]);
  });

  it("starts a new turn when the latest one's assignment is gone", () => {
    const office = collectionAssignment("office", "c-office", EPISODES);
    const first = generated(
      generateProgramming(options([office], { maxEntries: 1 })),
    );
    const parks = collectionAssignment("parks", "c-parks", [
      scheduleMedia("p1"),
    ]);

    const second = generated(
      generateProgramming(
        options([parks], {
          startsAt: first.generatedThrough,
          latestTurn: latestTurn(first),
          createBlockId: () => "block-2",
          maxEntries: 1,
        }),
      ),
    );

    expect(second.entries[0]).toMatchObject({
      mediaItemId: "p1",
      programmingBlockId: "block-2",
    });
    expect(second.blocks[0]?.roundNumber).toBe(2);
  });
});

describe("generateProgramming: single items", () => {
  it("airs a single-item assignment once per turn, whatever its stretch", () => {
    const special = scheduleMedia("special", { durationMs: 30 * 60_000 });

    const result = generated(
      generateProgramming(
        options([itemAssignment("holiday", special)], {
          through: STARTS_AT + 2 * HOUR_MS,
        }),
      ),
    );

    expect(result.entries.map((entry) => entry.programmingBlockId)).toEqual([
      "block-1",
      "block-2",
      "block-3",
      "block-4",
    ]);
    expect(result.blocks[0]).toMatchObject({
      source: { kind: "media_item", mediaItemId: "special" },
      size: null,
    });
    expect(result.progress).toEqual([]);
  });
});

describe("generateProgramming: unschedulable channels", () => {
  it("reports a channel with no assignment", () => {
    expect(generateProgramming(options([]))).toEqual({
      kind: "unschedulable",
      reason: "no_programming_assignment",
    });
  });

  it("reports a channel whose only assignment has nothing schedulable", () => {
    const assignment = collectionAssignment("office", "c-office", [
      scheduleMedia("gone", { status: "missing" }),
    ]);

    expect(generateProgramming(options([assignment]))).toEqual({
      kind: "unschedulable",
      reason: "no_schedulable_media",
    });
  });
});

describe("generateProgramming: turns ended by an edit", () => {
  it("never continues a turn an edit ended, and moves on to the next turn", () => {
    const assignment = collectionAssignment("office", "c-office", EPISODES);
    const first = generated(
      generateProgramming(options([assignment], { maxEntries: 1 })),
    );
    const turn = latestTurn(first);
    if (turn === undefined) throw new Error("expected a turn");

    const next = generated(
      generateProgramming(
        options([assignment], {
          startsAt: first.generatedThrough,
          nextSequenceNumber: first.nextSequenceNumber,
          latestTurn: { ...turn, block: { ...turn.block, endedByEdit: true } },
          progress: first.progress,
          maxEntries: 1,
          createBlockId: () => "block-2",
        }),
      ),
    );

    expect(next.entries[0]).toMatchObject({
      mediaItemId: "e2",
      programmingBlockId: "block-2",
    });
    expect(next.blocks[0]?.roundNumber).toBe(2);
  });
});
