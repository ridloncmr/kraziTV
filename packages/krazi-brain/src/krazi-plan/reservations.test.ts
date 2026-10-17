import { describe, expect, it } from "vitest";

import {
  collectionAssignment,
  generateInChunks,
  sequentialBlockIds,
  generatedProgramming as generated,
} from "../testing/programming-assignments.js";
import {
  collectionReservation,
  itemsReservation,
} from "../testing/reservations.js";
import {
  scheduleMedia,
  numberedMedia as items,
} from "../testing/schedule-media.js";
import type { GeneratedScheduleEntry } from "../schedule/contracts.js";
import type {
  GeneratedBlock,
  ProgrammingAssignment,
  Reservation,
} from "./contracts.js";
import {
  generateProgramming,
  type GenerateProgrammingOptions,
} from "./generate-programming.js";

// 2026-01-01T00:00:00.000Z as a UTC millisecond schedule anchor.
const STARTS_AT = 1_767_225_600_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const at = (minutes: number) => STARTS_AT + minutes * MINUTE_MS;

// A sitcom of `minutes`-long episodes, three a turn.
function sitcom(id: string, minutes: number): ProgrammingAssignment {
  return collectionAssignment(id, `c-${id}`, items(id, 6, minutes));
}

// A movie collection, one two-hour film a turn.
function movies(id: string): ProgrammingAssignment {
  return collectionAssignment(id, `c-${id}`, items(id, 6, 120), {
    ordinary: { kind: "programs", count: 1 },
  });
}

const MOVIE = scheduleMedia("movie", { durationMs: 120 * MINUTE_MS });

function options(
  assignments: readonly ProgrammingAssignment[],
  reservations: readonly Reservation[],
  overrides: Partial<GenerateProgrammingOptions> = {},
): GenerateProgrammingOptions {
  return {
    channelSeed: 0x5d4886b3,
    programmingSeed: 0x1234abcd,
    rebuildCount: 0,
    marathons: { chancePercent: 0, minOrdinaryRounds: 2 },
    assignments,
    rules: [],
    reservations,
    timeZone: "UTC",
    latestTurn: undefined,
    progress: [],
    startsAt: STARTS_AT,
    through: at(12 * 60),
    nextSequenceNumber: 0,
    maxEntries: 500,
    createBlockId: sequentialBlockIds(),
    ...overrides,
  };
}

// Each entry as `<media>@<minutes after STARTS_AT>`, the shape every test reads.
function airings(entries: readonly GeneratedScheduleEntry[]): string[] {
  return entries.map(
    (entry) =>
      `${entry.mediaItemId}@${(entry.startsAt - STARTS_AT) / MINUTE_MS}`,
  );
}

// The block an entry aired in.
function blockOf(
  blocks: readonly GeneratedBlock[],
  entry: GeneratedScheduleEntry | undefined,
): GeneratedBlock | undefined {
  return blocks.find((block) => block.id === entry?.programmingBlockId);
}

describe("generateProgramming: reservations", () => {
  it("leaves no gap when the program before a reservation ends exactly at its start", () => {
    const { entries, blocks } = generated(
      generateProgramming(
        options(
          [sitcom("office", 30)],
          [itemsReservation("r1", at(90), at(210), [MOVIE])],
          { through: at(240) },
        ),
      ),
    );

    expect(airings(entries)).toEqual([
      "office1@0",
      "office2@30",
      "office3@60",
      "movie@90",
      "office4@210",
    ]);
    const reserved = blockOf(blocks, entries[3]);
    expect(reserved).toMatchObject({
      reservationId: "r1",
      assignmentId: null,
      source: null,
      startsAt: at(90),
    });
  });

  it("defers a program that cannot finish before the reservation without consuming its progress", () => {
    const { entries } = generated(
      generateProgramming(
        options(
          [sitcom("office", 40)],
          [itemsReservation("r1", at(100), at(160), items("short", 1, 60))],
          { through: at(200) },
        ),
      ),
    );

    // office3 would end at 120, past the start at 100: it airs after the
    // reservation instead, and no shorter later program is searched for.
    expect(airings(entries)).toEqual([
      "office1@0",
      "office2@40",
      "short1@100",
      "office3@160",
    ]);
  });

  it("ends a started turn at the reservation and gives the next turn to the next assignment", () => {
    const assignments = [sitcom("office", 40), sitcom("parks", 40)];
    const { entries, blocks } = generated(
      generateProgramming(
        options(
          assignments,
          [itemsReservation("r1", at(100), at(160), items("short", 1, 60))],
          { through: at(300) },
        ),
      ),
    );

    const before = blockOf(blocks, entries[0]);
    const after = blockOf(
      blocks,
      entries.find((entry) => entry.startsAt === at(160)),
    );
    // Two of the three programs aired before the reservation; the turn is over.
    expect(
      entries.filter((entry) => entry.programmingBlockId === before?.id),
    ).toHaveLength(2);
    expect(after?.id).not.toBe(before?.id);
    expect(after?.assignmentId).not.toBe(before?.assignmentId);
    expect(after?.reservationId).toBeNull();
  });

  it.each([
    { name: "ordinary", chancePercent: 0 },
    { name: "marathon", chancePercent: 100 },
  ])(
    "redraws an unstarted $name turn identically after the reservation, recording its skips once",
    ({ chancePercent }) => {
      const assignments = [
        sitcom("office", 30),
        { ...movies("films"), marathon: { kind: "programs", count: 2 } },
        // Never usable, so every round it forms records a skip.
        collectionAssignment("empty", "c-empty", []),
      ] satisfies ProgrammingAssignment[];
      const marathons = { chancePercent, minOrdinaryRounds: 0 };
      const free = generated(
        generateProgramming(
          options(assignments, [], { through: at(24 * 60), marathons }),
        ),
      );
      // The first film turn, and a reservation starting an hour into it, so
      // its two-hour film cannot fit and the turn never starts.
      const filmBlock = free.blocks.find(
        (block) => block.assignmentId === "films",
      );
      if (filmBlock === undefined) throw new Error("no film turn");
      const reservation = itemsReservation(
        "r1",
        filmBlock.startsAt + HOUR_MS,
        filmBlock.startsAt + HOUR_MS + 30 * MINUTE_MS,
        items("short", 1, 30),
      );

      const reserved = generated(
        generateProgramming(
          options(assignments, [reservation], {
            through: at(24 * 60),
            marathons,
          }),
        ),
      );

      const turns = (blocks: readonly GeneratedBlock[]) =>
        blocks
          .filter((block) => block.reservationId === null)
          .slice(0, 6)
          .map(({ assignmentId, roundNumber, turnIndex, marathon }) => ({
            assignmentId,
            roundNumber,
            turnIndex,
            marathon,
          }));
      expect(turns(reserved.blocks)).toEqual(turns(free.blocks));
      const redrawn = reserved.blocks.find(
        (block) => block.assignmentId === "films",
      );
      expect(redrawn).toMatchObject({
        startsAt: reservation.endsAt,
        marathon: filmBlock.marathon,
        checkpoint: filmBlock.checkpoint,
      });
      const early = (skips: typeof free.skips) =>
        skips.filter((skip) => skip.roundNumber <= filmBlock.roundNumber);
      expect(early(reserved.skips)).toEqual(early(free.skips));
    },
  );

  it("adds only the collection programs that fit a reserved range and consumes their progress", () => {
    const specials = items("special", 6, 50);
    const { entries, progress, blocks } = generated(
      generateProgramming(
        options(
          [sitcom("office", 30)],
          [
            collectionReservation(
              "r1",
              at(90),
              at(270),
              "c-specials",
              specials,
            ),
          ],
          { through: at(300) },
        ),
      ),
    );

    expect(airings(entries)).toEqual([
      "office1@0",
      "office2@30",
      "office3@60",
      "special1@90",
      "special2@140",
      "special3@190",
      "office4@270",
    ]);
    expect(blockOf(blocks, entries[3])).toMatchObject({
      reservationId: "r1",
      source: {
        kind: "collection",
        mediaCollectionId: "c-specials",
        playbackMode: "chronological",
      },
    });
    expect(
      progress.find((entry) => entry.mediaCollectionId === "c-specials"),
    ).toEqual({
      mediaCollectionId: "c-specials",
      playbackMode: "chronological",
      progress: {
        lastMediaItemId: "special3",
        lastPosition: 2,
        nextSelectionIndex: 0,
      },
    });
  });

  it("airs a reserved list in order and only the items that fit", () => {
    const { entries } = generated(
      generateProgramming(
        options(
          [sitcom("office", 30)],
          [
            itemsReservation("r1", at(90), at(180), [
              ...items("pilot", 1, 60),
              ...items("finale", 1, 60),
            ]),
          ],
          { through: at(200) },
        ),
      ),
    );

    expect(airings(entries)).toEqual([
      "office1@0",
      "office2@30",
      "office3@60",
      "pilot1@90",
      "office4@180",
    ]);
  });

  it("resumes at the reservation's end and covers through it even when asked for less", () => {
    const result = generated(
      generateProgramming(
        options(
          [sitcom("office", 40)],
          [
            collectionReservation(
              "r1",
              at(100),
              at(220),
              "c-x",
              items("x", 3, 50),
            ),
          ],
          { through: at(95) },
        ),
      ),
    );

    expect(airings(result.entries)).toEqual([
      "office1@0",
      "office2@40",
      "x1@100",
      "x2@150",
    ]);
    expect(result.generatedThrough).toBe(at(220));
  });

  it("starts no block when nothing fits a reserved range and still ends the started turn", () => {
    const { entries, blocks } = generated(
      generateProgramming(
        options(
          [sitcom("office", 40)],
          [
            collectionReservation(
              "r1",
              at(100),
              at(190),
              "c-x",
              items("x", 3, 120),
            ),
          ],
          { through: at(300) },
        ),
      ),
    );

    expect(airings(entries)).toEqual([
      "office1@0",
      "office2@40",
      "office3@190",
      "office4@230",
      "office5@270",
    ]);
    expect(blocks.some((block) => block.reservationId !== null)).toBe(false);
    expect(blockOf(blocks, entries[2])?.id).not.toBe(
      entries[0]?.programmingBlockId,
    );
  });

  it("generates the same programming around reservations in any chunk size", () => {
    const base = options(
      [sitcom("office", 40), movies("films"), sitcom("parks", 25)],
      [
        itemsReservation("r1", at(100), at(250), [MOVIE]),
        collectionReservation("r2", at(400), at(600), "c-x", items("x", 4, 50)),
        collectionReservation(
          "r3",
          at(600),
          at(700),
          "c-y",
          items("y", 2, 120),
        ),
        itemsReservation("r4", at(800), at(1000), [
          ...items("a", 1, 70),
          ...items("b", 1, 70),
        ]),
      ],
      { through: at(24 * 60) },
    );
    const run = (chunkSize: number) =>
      generateInChunks(
        { ...base, createBlockId: sequentialBlockIds() },
        chunkSize,
      );

    const whole = run(500);
    expect(run(1)).toEqual(whole);
    expect(run(3)).toEqual(whole);
    // Every reservation's first program airs at its exact start.
    for (const start of [100, 400, 800]) {
      expect(whole.entries.some((entry) => entry.startsAt === at(start))).toBe(
        true,
      );
    }
  });
});

describe("generateProgramming: resuming around reservations", () => {
  const LIST = itemsReservation("r1", at(90), at(270), [
    ...items("a", 1, 60),
    ...items("b", 1, 60),
    ...items("c", 1, 60),
  ]);
  const office = sitcom("office", 30);
  // Office's progress once its third episode, the last before the list, aired.
  const officeProgress = [
    {
      mediaCollectionId: "c-office",
      playbackMode: "chronological" as const,
      progress: {
        lastMediaItemId: "office3",
        lastPosition: 2,
        nextSelectionIndex: 0,
      },
    },
  ];

  // The run through the list's first item, as the server keeps it.
  function keptThroughFirstItem() {
    const whole = generated(
      generateProgramming(options([office], [LIST], { through: at(400) })),
    );
    const block = whole.blocks.find((kept) => kept.reservationId === "r1");
    if (block === undefined) throw new Error("no reservation block");
    return { whole, block };
  }

  it("stops a reserved list at the first item that does not fit, without searching later ones", () => {
    const { entries } = generated(
      generateProgramming(
        options(
          [office],
          [
            itemsReservation("r1", at(90), at(180), [
              ...items("long", 2, 60),
              ...items("short", 1, 10),
            ]),
          ],
          { through: at(200) },
        ),
      ),
    );

    expect(airings(entries)).toEqual([
      "office1@0",
      "office2@30",
      "office3@60",
      "long1@90",
      "office4@180",
    ]);
  });

  it("resumes a list after the items it aired even when one has since left the catalog", () => {
    const { block } = keptThroughFirstItem();
    const [first, ...rest] =
      LIST.source.kind === "media_items" ? LIST.source.items : [];
    if (first === undefined) throw new Error("no first item");

    const { entries } = generated(
      generateProgramming(
        options(
          [office],
          [
            {
              ...LIST,
              source: {
                kind: "media_items",
                items: [{ ...first, status: "missing" }, ...rest],
              },
            },
          ],
          {
            startsAt: at(150),
            through: at(280),
            progress: officeProgress,
            latestTurn: {
              block,
              airedMediaItemIds: ["a1"],
              airedMs: 60 * MINUTE_MS,
            },
          },
        ),
      ),
    );

    expect(airings(entries)).toEqual(["b1@150", "c1@210", "office4@270"]);
  });

  it("continues a reservation's list through a fresh rebuild instead of airing it from the top", () => {
    const { block } = keptThroughFirstItem();

    const { entries } = generated(
      generateProgramming(
        options([office], [LIST], {
          rebuildCount: 1,
          startsAt: at(150),
          through: at(280),
          latestTurn: {
            block,
            airedMediaItemIds: ["a1"],
            airedMs: 60 * MINUTE_MS,
          },
        }),
      ),
    );

    expect(airings(entries).slice(0, 2)).toEqual(["b1@150", "c1@210"]);
  });

  it("still knows a reservation's block took no turn once the reservation is deleted", () => {
    const { whole, block } = keptThroughFirstItem();
    const latestTurn = {
      block,
      airedMediaItemIds: ["a1", "b1", "c1"],
      airedMs: 180 * MINUTE_MS,
    };
    const after = (reservations: readonly Reservation[]) =>
      generated(
        generateProgramming(
          options([office], reservations, {
            startsAt: at(270),
            through: at(400),
            progress: officeProgress,
            latestTurn,
            createBlockId: sequentialBlockIds("after"),
          }),
        ),
      );

    expect(after([])).toEqual(after([LIST]));
    expect(airings(after([]).entries)[0]).toBe(
      airings(whole.entries).find((airing) => airing.endsWith("@270")),
    );
  });
});

describe("generateProgramming: reservations without ordinary programming", () => {
  it("airs reservations on a channel with no assignment, covering the time before each with filler", () => {
    const result = generated(
      generateProgramming(
        options(
          [],
          [
            itemsReservation("r1", at(90), at(210), [MOVIE]),
            itemsReservation("r2", at(300), at(420), [MOVIE]),
          ],
          { through: at(12 * 60) },
        ),
      ),
    );

    expect(airings(result.entries)).toEqual(["movie@90", "movie@300"]);
    expect(result.generatedThrough).toBe(at(420));
  });

  it("still reports an assignment-less channel with no reservation ahead unschedulable", () => {
    expect(
      generateProgramming(
        options([], [itemsReservation("r1", at(0), at(120), [MOVIE])], {
          startsAt: at(200),
        }),
      ),
    ).toEqual({ kind: "unschedulable", reason: "no_programming_assignment" });
  });

  it("reaches a reservation after the last schedulable ordinary program", () => {
    // Ordinary media all missing: nothing ordinary can air.
    const missing = collectionAssignment("gone", "c-gone", [
      scheduleMedia("m1", { status: "missing" }),
    ]);

    const result = generated(
      generateProgramming(
        options([missing], [itemsReservation("r1", at(90), at(210), [MOVIE])]),
      ),
    );

    expect(airings(result.entries)).toEqual(["movie@90"]);
  });
});
