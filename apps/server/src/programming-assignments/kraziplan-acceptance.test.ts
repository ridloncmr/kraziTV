// Programming spec 0004 acceptance: four collections, configured once
// through the API, generate weeks of programming that keep kraziPlan's
// rotation, stretch, and marathon guarantees through chunked generation,
// a restart, regeneration, edits, and joins.
import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import { send, windowUrl } from "../testing/api-requests.js";
import { collectionAssignment } from "../testing/assignment-bodies.js";
import { FIXTURE_TIME } from "../testing/catalog-fixtures.js";
import {
  assignmentsByRound,
  insertCollectionOfItems,
  readBlocks,
  readScheduleEntries,
  readScheduleShape,
} from "../testing/schedule-fixtures.js";
import {
  startScheduleScenarioServer,
  startScheduleServer,
} from "../testing/schedule-server.js";
import { cleanUpTestEnvironment } from "../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const T0 = FIXTURE_TIME;
const WEEKS = 3;
// The channel seedScheduleScenario writes.
const CHANNEL_ID = "channel-fixture-001";
const ASSIGNMENTS_URL = `/channels/${CHANNEL_ID}/programming-assignments`;
const GENERATE_URL = `/channels/${CHANNEL_ID}/schedule/generate`;

type Blocks = Awaited<ReturnType<typeof readBlocks>>;
type Entries = Awaited<ReturnType<typeof readScheduleEntries>>;

/**
 * Catalogs and assigns four collections, each with its own stretch, after
 * allowing marathons in every eligible round with a two-round cooldown.
 * Only movies may marathon, so every marathon is a movies turn.
 */
async function configureFourSources(
  server: FastifyInstance,
  db: Kysely<DatabaseSchema>,
) {
  await insertCollectionOfItems(db, "office", Array(6).fill(22 * MINUTE));
  await insertCollectionOfItems(db, "parks", Array(5).fill(30 * MINUTE));
  await insertCollectionOfItems(
    db,
    "movies",
    [90, 100, 120, 95].map((minutes) => minutes * MINUTE),
  );
  await insertCollectionOfItems(db, "scrubs", Array(8).fill(25 * MINUTE));
  await send(server, "PUT", `/channels/${CHANNEL_ID}/programming-settings`, {
    marathonChancePercent: 100,
    marathonMinOrdinaryRounds: 2,
  });
  const create = async (body: object) =>
    (await send(server, "POST", ASSIGNMENTS_URL, body)).body.id as string;
  return {
    office: await create({
      ...collectionAssignment("office"),
      ordinaryStretch: { kind: "airtime", minutes: 60 },
    }),
    parks: await create({
      ...collectionAssignment("parks"),
      ordinaryStretch: { kind: "programs", count: 2 },
    }),
    movies: await create({
      ...collectionAssignment("movies"),
      ordinaryStretch: { kind: "programs", count: 1 },
      marathonStretch: { kind: "programs", count: 2 },
    }),
    scrubs: await create({
      ...collectionAssignment("scrubs", "random"),
      ordinaryStretch: {
        kind: "airtime_range",
        minMinutes: 45,
        maxMinutes: 75,
      },
    }),
  };
}

// The entries one block aired, in order.
function entriesOf(entries: Entries, blockId: string) {
  return entries.filter((entry) => entry.programming_block_id === blockId);
}

// Every round except the last, which coverage may have cut short.
function completeRounds(blocks: Blocks) {
  return [...assignmentsByRound(blocks).values()].slice(0, -1);
}

// The blocks before the last round, whose turns coverage cannot have cut short.
function completeTurns(blocks: Blocks) {
  const lastRound = blocks.at(-1)?.round_number ?? 0;
  return blocks.filter((block) => block.round_number < lastRound);
}

// The assignments still to air in the round of the turn airing at `now`.
function pendingInRound(blocks: Blocks, now: number) {
  const airing = blocks.findLast((block) => block.starts_at <= now);
  return blocks
    .filter(
      (block) =>
        block.round_number === airing?.round_number &&
        block.starts_at > (airing?.starts_at ?? now),
    )
    .map((block) => block.assignment_id);
}

describe("kraziPlan acceptance", () => {
  it("programs four collections for weeks, the same in any chunk size, across a restart, and after regeneration", async () => {
    const { server, db, clock, dataDirectory } =
      await startScheduleScenarioServer(
        { source: null },
        { entriesPerTransaction: 7 },
      );
    const ids = await configureFourSources(server, db);

    // Days pass and coverage follows, in chunks of seven, restarting halfway
    // into a server that writes whole days in one transaction. Nobody edits
    // anything.
    const coverDays = async (target: FastifyInstance, days: number[]) => {
      for (const day of days) {
        clock.set(T0 + day * DAY);
        const covered = await send(target, "POST", GENERATE_URL, {});
        expect(covered.status).toBe(200);
      }
    };
    await coverDays(server, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    await server.close();
    const restarted = await startScheduleServer(dataDirectory, clock, "second");
    await coverDays(
      restarted.server,
      Array.from({ length: WEEKS * 7 - 10 }, (_, index) => index + 11),
    );
    // Regenerating everything after the airing program in one pass writes
    // the same programming. Rows are rewritten at a later time, and sequence
    // numbers are never reused, so only what airs is compared.
    const programming = async () => {
      const { blocks, entries } = await readScheduleShape(
        restarted.db,
        CHANNEL_ID,
      );
      return {
        blocks: blocks.map(
          ({ created_at: _, updated_at: __, ...block }) => block,
        ),
        entries: entries.map(
          ({ created_at: _, updated_at: __, sequence_number: ___, ...entry }) =>
            entry,
        ),
      };
    };
    const generated = await programming();
    const regenerated = await send(restarted.server, "POST", GENERATE_URL, {
      regenerate: true,
    });
    expect(regenerated.status).toBe(200);
    await expect(programming()).resolves.toEqual(generated);

    const blocks = await readBlocks(restarted.db);
    const entries = await readScheduleEntries(restarted.db, CHANNEL_ID);
    expect(entries.at(-1)?.ends_at).toBeGreaterThanOrEqual(
      T0 + WEEKS * 7 * DAY,
    );
    for (let index = 1; index < entries.length; index += 1) {
      expect(entries[index]?.starts_at).toBe(entries[index - 1]?.ends_at);
    }

    // Office was the only assignment when its first program began airing,
    // so the others joined at round two. From then on every complete round
    // gives each source exactly one turn, and no source airs twice in a row.
    const [firstRound, ...rounds] = completeRounds(blocks);
    expect(firstRound).toEqual([ids.office]);
    expect(rounds.length).toBeGreaterThan(WEEKS * 7 * 4);
    for (const round of rounds) {
      expect([...round].sort()).toEqual(Object.values(ids).sort());
    }
    for (let index = 1; index < blocks.length; index += 1) {
      expect(blocks[index]?.assignment_id).not.toBe(
        blocks[index - 1]?.assignment_id,
      );
    }
    // The shuffle varies the order between rounds.
    expect(new Set(rounds.map((round) => round.join())).size).toBeGreaterThan(
      1,
    );

    // Each chronological collection resumes its own saved order, wrapping.
    for (const [collection, size] of [
      ["office", 6],
      ["parks", 5],
      ["movies", 4],
    ] as const) {
      const aired = entries
        .filter((entry) => entry.media_collection_id === collection)
        .map((entry) => entry.media_item_id);
      expect(aired).toEqual(
        aired.map((_, index) => `${collection}-${(index % size) + 1}`),
      );
    }

    for (const block of completeTurns(blocks)) {
      const aired = entriesOf(entries, block.id);
      const minutes = aired.map((entry) => entry.duration_ms / MINUTE);
      switch (block.assignment_id) {
        // A 60-minute target airs three whole 22-minute episodes every turn.
        case ids.office:
          expect(block).toMatchObject({
            resolved_kind: "airtime",
            resolved_value: 60,
          });
          expect(minutes).toEqual([22, 22, 22]);
          break;
        // Two programs a turn, wrapping through five.
        case ids.parks:
          expect(minutes).toEqual([30, 30]);
          break;
        // One whole movie a turn whatever its length; a marathon airs two
        // and adds none to meet airtime.
        case ids.movies:
          expect(aired).toHaveLength(block.marathon === 1 ? 2 : 1);
          expect(block.resolved_value).toBe(block.marathon === 1 ? 2 : 1);
          break;
        // A variable range resolves once within its bounds, and the turn
        // airs whole programs until it is met.
        case ids.scrubs: {
          const target = block.resolved_value ?? 0;
          const total = minutes.reduce((sum, value) => sum + value, 0);
          expect(target).toBeGreaterThanOrEqual(45);
          expect(target).toBeLessThanOrEqual(75);
          expect(total).toBeGreaterThanOrEqual(target);
          expect(total - 25).toBeLessThan(target);
          break;
        }
        default:
          throw new Error(`unexpected assignment ${block.assignment_id}`);
      }
    }
    // Resolved scrubs targets vary between turns.
    expect(
      new Set(
        blocks
          .filter((block) => block.assignment_id === ids.scrubs)
          .map((block) => block.resolved_value),
      ).size,
    ).toBeGreaterThan(1);

    // At most one marathon a round, each followed by two ordinary rounds.
    const marathonRounds = blocks
      .filter((block) => block.marathon === 1)
      .map((block) => block.round_number);
    expect(marathonRounds.length).toBeGreaterThan(5);
    expect(
      marathonRounds
        .slice(1)
        .map((round, index) => round - (marathonRounds[index] ?? 0)),
    ).toEqual(marathonRounds.slice(1).map(() => 3));
  });

  it("keeps the rotation through joins, removals, a turn-ending edit, and a restart", async () => {
    const { server, db, clock, dataDirectory } =
      await startScheduleScenarioServer({ source: null });
    const ids = await configureFourSources(server, db);
    await insertCollectionOfItems(db, "frasier", Array(4).fill(22 * MINUTE));

    // Tune in a minute into round two, with three turns still pending.
    const roundTwo = (await readBlocks(db)).find(
      (block) => block.round_number === 2,
    );
    clock.set((roundTwo?.starts_at ?? 0) + MINUTE);
    const pending = pendingInRound(await readBlocks(db), clock.now());
    expect(pending).toHaveLength(3);

    // A joining assignment waits for the next round; the pending turns keep
    // their relative order and none airs twice.
    const frasier = (
      await send(server, "POST", ASSIGNMENTS_URL, {
        ...collectionAssignment("frasier"),
        ordinaryStretch: { kind: "programs", count: 1 },
      })
    ).body.id as string;
    let blocks = await readBlocks(db);
    expect(pendingInRound(blocks, clock.now())).toEqual(pending);
    expect(
      blocks.find((block) => block.assignment_id === frasier)?.round_number,
    ).toBe(3);

    // A removed pending assignment leaves the others' order intact. Office
    // stays for the edit below.
    const removed = pending.find((id) => id !== ids.office) ?? "";
    await send(server, "DELETE", `${ASSIGNMENTS_URL}/${removed}`);
    blocks = await readBlocks(db);
    expect(pendingInRound(blocks, clock.now())).toEqual(
      pending.filter((id) => id !== removed),
    );
    const remaining = [...Object.values(ids), frasier].filter(
      (id) => id !== removed,
    );
    for (const round of completeRounds(blocks).slice(2)) {
      expect([...round].sort()).toEqual([...remaining].sort());
    }

    // An office stretch edit during the turn's second episode ends the turn
    // after it. The next office turn takes the whole new target, owes
    // nothing for the cut, and continues the collection's order.
    let entries = await readScheduleEntries(db, CHANNEL_ID);
    const officeTurn = blocks.find(
      (block) =>
        block.assignment_id === ids.office && block.starts_at > clock.now(),
    );
    const [, second] = entriesOf(entries, officeTurn?.id ?? "");
    clock.set((second?.starts_at ?? 0) + MINUTE);
    await send(server, "PATCH", `${ASSIGNMENTS_URL}/${ids.office}`, {
      ...collectionAssignment("office"),
      ordinaryStretch: { kind: "airtime", minutes: 50 },
    });
    blocks = await readBlocks(db);
    entries = await readScheduleEntries(db, CHANNEL_ID);
    expect(
      blocks.find((block) => block.id === officeTurn?.id)?.ended_by_edit,
    ).toBe(1);
    expect(entriesOf(entries, officeTurn?.id ?? "")).toHaveLength(2);
    const nextOffice = blocks.find(
      (block) =>
        block.assignment_id === ids.office && block.starts_at > clock.now(),
    );
    expect(nextOffice).toMatchObject({
      resolved_kind: "airtime",
      resolved_value: 50,
    });
    const nextEpisodes = entriesOf(entries, nextOffice?.id ?? "");
    expect(nextEpisodes.map((entry) => entry.duration_ms / MINUTE)).toEqual([
      22, 22, 22,
    ]);
    const secondNumber = Number(second?.media_item_id.split("-")[1]);
    expect(nextEpisodes[0]?.media_item_id).toBe(
      `office-${(secondNumber % 6) + 1}`,
    );

    // After a restart, coverage a week later keeps the same rotation.
    await server.close();
    const restarted = await startScheduleServer(dataDirectory, clock, "second");
    clock.advance(7 * DAY);
    const read = await send(
      restarted.server,
      "GET",
      windowUrl(
        `/channels/${CHANNEL_ID}/schedule`,
        clock.now(),
        clock.now() + 60 * MINUTE,
      ),
    );
    expect(read.status).toBe(200);
    blocks = await readBlocks(restarted.db);
    const later = blocks.filter((block) => block.starts_at > clock.now());
    for (const round of completeRounds(later).slice(1)) {
      expect([...round].sort()).toEqual([...remaining].sort());
    }
    for (let index = 1; index < blocks.length; index += 1) {
      expect(blocks[index]?.assignment_id).not.toBe(
        blocks[index - 1]?.assignment_id,
      );
    }
  });
});
