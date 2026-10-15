import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import { FIXTURE_TIME, rootFixture } from "../testing/catalog-fixtures.js";
import { channelFixture } from "../testing/channel-fixtures.js";
import { manualClock } from "../testing/manual-clock.js";
import { sequentialIds } from "../testing/record-sources.js";
import { recordingLog } from "../testing/recording-log.js";
import {
  insertCollectionAssignment,
  insertCollectionOfItems,
  readBlocks,
  readScheduleEntries,
} from "../testing/schedule-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../testing/test-environment.js";
import { ScheduleService } from "./schedule-service.js";

afterEach(cleanUpTestEnvironment);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const T0 = FIXTURE_TIME;
const SOURCES = ["office", "parks", "scrubs", "frasier"];

// Seeds the fixture channel with one three-program assignment per source,
// each a collection of five 22-minute episodes, or of `emptied` none.
async function seedFourSources(emptied: readonly string[] = []) {
  const { db } = await openTestDatabase();
  await db.insertInto("channels").values(channelFixture).execute();
  await db.insertInto("media_roots").values(rootFixture).execute();
  for (const id of SOURCES) {
    await insertCollectionOfItems(
      db,
      id,
      emptied.includes(id) ? [] : Array(5).fill(22 * MINUTE),
    );
    await insertCollectionAssignment(db, {
      id: `assignment-${id}`,
      mediaCollectionId: id,
    });
  }
  return db;
}

// A schedule service with fixed IDs on a clock at T0.
function scheduleService(
  db: Kysely<DatabaseSchema>,
  entriesPerTransaction?: number,
) {
  return new ScheduleService(db, {
    now: manualClock(T0).now,
    createId: sequentialIds("entry"),
    createBlockId: sequentialIds("block"),
    entriesPerTransaction,
  });
}

describe("multi-source generation", () => {
  it("gives each source one turn per round and never repeats one back to back", async () => {
    const db = await seedFourSources();

    await scheduleService(db).ensureCoverage(channelFixture.id, recordingLog());

    const blocks = await readBlocks(db);
    const rounds = new Map<number, string[]>();
    for (const block of blocks) {
      rounds.set(block.round_number, [
        ...(rounds.get(block.round_number) ?? []),
        block.assignment_id ?? "",
      ]);
    }
    for (const round of [...rounds.values()].slice(0, -1)) {
      expect([...round].sort()).toEqual(
        SOURCES.map((id) => `assignment-${id}`).sort(),
      );
    }
    for (let index = 1; index < blocks.length; index += 1) {
      expect(blocks[index]?.assignment_id).not.toBe(
        blocks[index - 1]?.assignment_id,
      );
    }
    // Each collection resumes its own order after the others air.
    const entries = await readScheduleEntries(db, channelFixture.id);
    const office = entries
      .filter((entry) => entry.media_collection_id === "office")
      .map((entry) => entry.media_item_id);
    expect(office.slice(0, 7)).toEqual(
      [1, 2, 3, 4, 5, 1, 2].map((episode) => `office-${episode}`),
    );
  });

  it("writes identical blocks and entries in any chunk size and across a restart", async () => {
    const whole = await seedFourSources();
    await scheduleService(whole, 500).ensureCoverage(
      channelFixture.id,
      recordingLog(),
    );
    const chunked = await seedFourSources();
    // One service covers the first day in chunks of seven, then a
    // restarted one, with its own ID sources, finishes the horizon.
    await scheduleService(chunked, 7).ensureCoverage(
      channelFixture.id,
      recordingLog(),
      T0 + 24 * HOUR,
    );
    const restarted = new ScheduleService(chunked, {
      now: manualClock(T0).now,
      createId: sequentialIds("entry"),
      createBlockId: sequentialIds("block"),
      entriesPerTransaction: 3,
    });
    await restarted.ensureCoverage(channelFixture.id, recordingLog());

    // IDs restart with the process; everything they name must match.
    const shape = async (db: Kysely<DatabaseSchema>) => {
      const blocks = await readBlocks(db);
      const entries = await readScheduleEntries(db, channelFixture.id);
      const blockIndex = new Map(
        blocks.map((block, index) => [block.id, index]),
      );
      return {
        // A turn's checkpoint names assignments, never block IDs.
        blocks: blocks.map(({ id: _, ...block }) => block),
        entries: entries.map(({ id: _, programming_block_id, ...entry }) => ({
          ...entry,
          block: blockIndex.get(programming_block_id ?? ""),
        })),
      };
    };
    expect(await shape(chunked)).toEqual(await shape(whole));
  });

  it("skips an empty collection's assignment, and reports a channel with nothing usable", async () => {
    const db = await seedFourSources(["scrubs"]);

    await scheduleService(db).ensureCoverage(channelFixture.id, recordingLog());

    const blocks = await readBlocks(db);
    expect(new Set(blocks.map((block) => block.assignment_id))).toEqual(
      new Set(["assignment-office", "assignment-parks", "assignment-frasier"]),
    );
    expect(JSON.parse(blocks[0]?.checkpoint ?? "{}")).toMatchObject({
      skipped: ["assignment-scrubs"],
    });

    const nothing = await seedFourSources(SOURCES);
    await expect(
      scheduleService(nothing).ensureCoverage(
        channelFixture.id,
        recordingLog(),
      ),
    ).resolves.toEqual({
      kind: "unschedulable",
      reason: "no_schedulable_media",
    });
    await expect(readBlocks(nothing)).resolves.toEqual([]);
  });
});
