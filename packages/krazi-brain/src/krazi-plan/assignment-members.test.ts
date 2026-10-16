import { describe, expect, it } from "vitest";

import {
  collectionAssignment,
  generateInChunks,
  latestTurn,
  sequentialBlockIds,
  generatedProgramming as generated,
} from "../testing/programming-assignments.js";
import { scheduleMedia } from "../testing/schedule-media.js";
import type { ScheduleMedia } from "../schedule/contracts.js";
import type { AssignmentMember, ProgrammingAssignment } from "./contracts.js";
import {
  generateProgramming,
  type GenerateProgrammingOptions,
} from "./generate-programming.js";

// 2026-01-01T00:00:00.000Z as a UTC millisecond schedule anchor.
const STARTS_AT = 1_767_225_600_000;
const DAY_MS = 24 * 60 * 60 * 1000;

// `count` 22-minute episodes named `<prefix>1`, `<prefix>2`, ...
function episodes(prefix: string, count: number): ScheduleMedia[] {
  return Array.from({ length: count }, (_, index) =>
    scheduleMedia(`${prefix}${index + 1}`, { durationMs: 22 * 60_000 }),
  );
}

// A collection member named `c-<prefix>` of `count` episodes.
function collection(prefix: string, count = 5): AssignmentMember {
  return {
    kind: "collection",
    mediaCollectionId: `c-${prefix}`,
    members: episodes(prefix, count),
  };
}

// An assignment of several members, two programs a turn.
function sitcoms(members: AssignmentMember[]): ProgrammingAssignment {
  return {
    id: "sitcoms",
    participation: "default",
    playbackMode: "chronological",
    ordinary: { kind: "programs", count: 2 },
    marathon: null,
    members,
  };
}

const MOVIES = collectionAssignment("movies", "c-movies", episodes("m", 9), {
  ordinary: { kind: "programs", count: 1 },
});

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
    reservations: [],
    timeZone: "UTC",
    latestTurn: undefined,
    progress: [],
    startsAt: STARTS_AT,
    through: STARTS_AT + DAY_MS,
    nextSequenceNumber: 0,
    maxEntries: 5000,
    createBlockId: sequentialBlockIds(),
    ...overrides,
  };
}

// The member each of an assignment's turns went to, in airing order.
function memberTurns(
  blocks: ReturnType<typeof generated>["blocks"],
  assignmentId = "sitcoms",
): string[] {
  return blocks
    .filter((block) => block.assignmentId === assignmentId)
    .map((block) =>
      block.source?.kind === "collection"
        ? block.source.mediaCollectionId
        : (block.source?.mediaItemId ?? ""),
    );
}

describe("generateProgramming: several members in one assignment", () => {
  it("takes one turn per round and gives successive turns to its members in saved order", () => {
    const { blocks, entries } = generated(
      generateProgramming(
        options([
          sitcoms([collection("a"), collection("b"), collection("c")]),
          MOVIES,
        ]),
      ),
    );

    expect(memberTurns(blocks).slice(0, 5)).toEqual([
      "c-a",
      "c-b",
      "c-c",
      "c-a",
      "c-b",
    ]);
    const rounds = new Map<number, number>();
    for (const block of blocks.filter((b) => b.assignmentId === "sitcoms")) {
      rounds.set(block.roundNumber, (rounds.get(block.roundNumber) ?? 0) + 1);
    }
    expect([...rounds.values()].every((turns) => turns === 1)).toBe(true);
    // Each collection resumes its own progress.
    expect(
      entries
        .filter((entry) => entry.mediaCollectionId === "c-a")
        .map((entry) => entry.mediaItemId)
        .slice(0, 6),
    ).toEqual(["a1", "a2", "a3", "a4", "a5", "a1"]);
  });

  it("skips an unschedulable member without consuming its progress", () => {
    const { blocks, progress } = generated(
      generateProgramming(
        options([
          sitcoms([
            collection("a"),
            {
              kind: "collection",
              mediaCollectionId: "c-gone",
              members: [scheduleMedia("gone", { status: "missing" })],
            },
            collection("c"),
          ]),
          MOVIES,
        ]),
      ),
    );

    expect(memberTurns(blocks).slice(0, 4)).toEqual([
      "c-a",
      "c-c",
      "c-a",
      "c-c",
    ]);
    expect(progress.map((entry) => entry.mediaCollectionId)).not.toContain(
      "c-gone",
    );
  });

  it("skips an assignment none of whose members is schedulable", () => {
    const result = generated(
      generateProgramming(
        options([
          sitcoms([
            { kind: "collection", mediaCollectionId: "c-empty", members: [] },
            {
              kind: "media_item",
              media: scheduleMedia("x", { status: "missing" }),
            },
          ]),
          MOVIES,
        ]),
      ),
    );

    expect(memberTurns(result.blocks)).toEqual([]);
    expect(result.skips[0]).toEqual({
      assignmentId: "sitcoms",
      roundNumber: 1,
      reasons: ["empty_collection", "media_item_unschedulable"],
    });
  });

  it("airs a single-item member once a turn, whatever the stretch", () => {
    const film = scheduleMedia("wonderful-life", { durationMs: 130 * 60_000 });
    const { blocks, entries } = generated(
      generateProgramming(
        options([
          {
            ...sitcoms([
              collection("xmas"),
              { kind: "media_item", media: film },
            ]),
            ordinary: { kind: "programs", count: 3 },
          },
          MOVIES,
        ]),
      ),
    );

    const filmTurns = blocks.filter(
      (block) => block.source?.kind === "media_item",
    );
    expect(filmTurns.length).toBeGreaterThan(0);
    for (const block of filmTurns) {
      expect(block.size).toBeNull();
      expect(
        entries.filter((entry) => entry.programmingBlockId === block.id),
      ).toHaveLength(1);
    }
  });

  it.each([1, 2, 5])(
    "reproduces the same next member in chunks of %i and after a restart",
    (chunkSize) => {
      const assignments = [
        sitcoms([collection("a"), collection("b"), collection("c")]),
        MOVIES,
      ];
      const run = (size: number) =>
        generateInChunks(
          { ...options(assignments), createBlockId: sequentialBlockIds() },
          size,
        );

      expect(run(chunkSize)).toEqual(run(10_000));
    },
  );

  it("keeps the assignment's place in the round when its members change", () => {
    const first = generated(
      generateProgramming(
        options([sitcoms([collection("a"), collection("b")]), MOVIES], {
          maxEntries: 1,
        }),
      ),
    );
    const sitcomsFirst = first.blocks[0]?.assignmentId === "sitcoms";

    // A member is added before the next turn; the round carries on.
    const second = generated(
      generateProgramming(
        options(
          [
            sitcoms([collection("a"), collection("b"), collection("c")]),
            MOVIES,
          ],
          {
            startsAt: first.generatedThrough,
            nextSequenceNumber: first.nextSequenceNumber,
            latestTurn: latestTurn(first),
            progress: first.progress,
            createBlockId: sequentialBlockIds("later"),
            maxEntries: 6,
          },
        ),
      ),
    );

    const nextTurn = second.blocks[0];
    expect(nextTurn?.roundNumber).toBe(1);
    expect(nextTurn?.assignmentId).toBe(sitcomsFirst ? "movies" : "sitcoms");
  });
});
