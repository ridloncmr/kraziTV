import { deriveProgrammingSeed } from "@krazitv/krazi-brain";
import { type Kysely, sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import { ScheduleService } from "../../schedules/schedule-service.js";
import {
  collectionFixture,
  FIXTURE_TIME,
  rootFixture,
  titledItemFixture,
} from "../../testing/catalog-fixtures.js";
import {
  channelFixture,
  collectionProgressFixture,
  scheduleEntryFixture,
  scheduleStateFixture,
} from "../../testing/channel-fixtures.js";
import { sequentialIds } from "../../testing/record-sources.js";
import { recordingLog } from "../../testing/recording-log.js";
import { readScheduleEntries } from "../../testing/schedule-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";
import { sourceAssignmentsMigration } from "./021-source-assignments.js";
import { turnsEndedByEditsMigration } from "./022-turns-ended-by-edits.js";
import { assignmentParticipationMigration } from "./023-assignment-participation.js";
import { programmingRulesMigration } from "./024-programming-rules.js";
import { reservationsMigration } from "./027-reservations.js";
import { programmingRevisionMigration } from "./030-programming-revision.js";

afterEach(cleanUpTestEnvironment);

const HOUR = 3_600_000;
const LOOP = "channel-loop";
const SPECIAL = "channel-special";

// Rolls back to one configured block per channel and seeds two loops as
// they stood before 021: a chronological collection loop that has aired
// `a` and `b` of a, b, c, and a single-item loop of `special`, each with
// schedule state and covered entries.
async function legacyLoops() {
  const { db } = await openTestDatabase();
  const legacy = db as Kysely<unknown>;
  // Later migrations roll back first; 021 drops what 022 and 023 added.
  await programmingRevisionMigration.down?.(legacy);
  await reservationsMigration.down?.(legacy);
  await programmingRulesMigration.down?.(legacy);
  await sourceAssignmentsMigration.down?.(legacy);
  await db
    .insertInto("channels")
    .values([
      { ...channelFixture, id: LOOP, number: "1" },
      { ...channelFixture, id: SPECIAL, number: "2" },
    ])
    .execute();
  await db.insertInto("media_roots").values(rootFixture).execute();
  await db
    .insertInto("media_items")
    .values(
      ["a", "b", "c", "special"].map((id) =>
        titledItemFixture(id, { duration_ms: HOUR }),
      ),
    )
    .execute();
  await db.insertInto("media_collections").values(collectionFixture).execute();
  await db
    .insertInto("media_collection_items")
    .values(
      ["a", "b", "c"].map((id, position) => ({
        media_collection_id: collectionFixture.id,
        media_item_id: id,
        position,
        created_at: FIXTURE_TIME,
      })),
    )
    .execute();
  await sql`insert into programming_blocks values
    ('block-loop', ${LOOP}, 'collection', ${collectionFixture.id}, null,
      'chronological', ${FIXTURE_TIME}, ${FIXTURE_TIME}),
    ('block-special', ${SPECIAL}, 'media_item', null, 'special', null,
      ${FIXTURE_TIME}, ${FIXTURE_TIME})`.execute(legacy);
  for (const channelId of [LOOP, SPECIAL]) {
    await sql`insert into channel_schedule_states values (${channelId},
      ${scheduleStateFixture.seed}, ${FIXTURE_TIME}, ${FIXTURE_TIME + 2 * HOUR},
      2, 1, ${FIXTURE_TIME}, ${FIXTURE_TIME})`.execute(legacy);
  }
  await db
    .insertInto("schedule_entries")
    .values(
      [
        [LOOP, "a", "block-loop", collectionFixture.id, 0],
        [LOOP, "b", "block-loop", collectionFixture.id, 1],
        [SPECIAL, "special", "block-special", null, null],
        [SPECIAL, "special", "block-special", null, null],
      ].map(([channelId, itemId, blockId, collectionId, index], i) => ({
        ...scheduleEntryFixture,
        id: `entry-${i}`,
        channel_id: channelId as string,
        media_item_id: itemId as string,
        programming_block_id: blockId as string,
        media_collection_id: collectionId as string | null,
        playback_mode: collectionId === null ? null : "chronological",
        playback_index: index as number | null,
        starts_at: FIXTURE_TIME + (i % 2) * HOUR,
        ends_at: FIXTURE_TIME + ((i % 2) + 1) * HOUR,
        duration_ms: HOUR,
        sequence_number: i % 2,
      })),
    )
    .execute();
  await db
    .insertInto("channel_collection_progress")
    .values({
      ...collectionProgressFixture,
      channel_id: LOOP,
      last_media_item_id: "b",
      last_position: 1,
    })
    .execute();
  return db;
}

describe("021_source_assignments", () => {
  it("turns each loop into one assignment whose first turn is the old block", async () => {
    const db = await legacyLoops();
    const entriesBefore = await db
      .selectFrom("schedule_entries")
      .selectAll()
      .orderBy("id")
      .execute();
    const progressBefore = await db
      .selectFrom("channel_collection_progress")
      .selectAll()
      .execute();

    await sourceAssignmentsMigration.up(db as Kysely<unknown>);

    const assignments = await db
      .selectFrom("programming_source_assignments")
      .selectAll()
      .orderBy("channel_id")
      .execute();
    expect(assignments).toMatchObject([
      {
        channel_id: LOOP,
        playback_mode: "chronological",
        ordinary_kind: "programs",
        ordinary_min: 3,
        marathon_kind: null,
      },
      { channel_id: SPECIAL, playback_mode: null, marathon_kind: null },
    ]);
    await expect(
      db
        .selectFrom("programming_assignment_members")
        .select([
          "assignment_id",
          "channel_id",
          "position",
          "media_collection_id",
          "media_item_id",
        ])
        .orderBy("channel_id")
        .execute(),
    ).resolves.toEqual([
      {
        assignment_id: assignments[0]?.id,
        channel_id: LOOP,
        position: 0,
        media_collection_id: collectionFixture.id,
        media_item_id: null,
      },
      {
        assignment_id: assignments[1]?.id,
        channel_id: SPECIAL,
        position: 0,
        media_collection_id: null,
        media_item_id: "special",
      },
    ]);
    const loopBlock = await db
      .selectFrom("programming_blocks")
      .selectAll()
      .where("id", "=", "block-loop")
      .executeTakeFirstOrThrow();
    expect(loopBlock).toMatchObject({
      assignment_id: assignments[0]?.id,
      round_number: 1,
      turn_index: 0,
      starts_at: FIXTURE_TIME,
      resolved_kind: "programs",
      resolved_value: 3,
      marathon: 0,
    });
    expect(JSON.parse(loopBlock.checkpoint)).toMatchObject({
      roundNumber: 1,
      pending: [assignments[0]?.id],
    });
    await expect(
      db
        .selectFrom("programming_blocks")
        .select(["resolved_kind", "resolved_value"])
        .where("id", "=", "block-special")
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ resolved_kind: null, resolved_value: null });
    await expect(
      db.selectFrom("schedule_entries").selectAll().orderBy("id").execute(),
    ).resolves.toEqual(entriesBefore);
    await expect(
      db.selectFrom("channel_collection_progress").selectAll().execute(),
    ).resolves.toEqual(progressBefore);
    await expect(
      db
        .selectFrom("channel_schedule_states")
        .select(["channel_id", "seed", "programming_seed", "rebuild_count"])
        .orderBy("channel_id")
        .execute(),
    ).resolves.toEqual(
      [LOOP, SPECIAL].map((channelId) => ({
        channel_id: channelId,
        seed: scheduleStateFixture.seed,
        programming_seed: deriveProgrammingSeed(channelId, FIXTURE_TIME),
        rebuild_count: 0,
      })),
    );
  });

  it("keeps each loop's next pick, and keeps the single item looping", async () => {
    const db = await legacyLoops();
    await sourceAssignmentsMigration.up(db as Kysely<unknown>);
    // Generating needs every later migration too.
    await turnsEndedByEditsMigration.up(db as Kysely<unknown>);
    await assignmentParticipationMigration.up(db as Kysely<unknown>);
    await programmingRulesMigration.up(db as Kysely<unknown>);
    await reservationsMigration.up(db as Kysely<unknown>);
    await programmingRevisionMigration.up(db as Kysely<unknown>);
    const schedules = new ScheduleService(db, {
      now: () => FIXTURE_TIME,
      createId: sequentialIds("next"),
    });

    for (const channelId of [LOOP, SPECIAL]) {
      await schedules.ensureCoverage(
        channelId,
        recordingLog(),
        FIXTURE_TIME + 5 * HOUR,
      );
    }

    const picks = async (channelId: string) =>
      (await readScheduleEntries(db, channelId))
        .slice(0, 5)
        .map((entry) => entry.media_item_id);
    await expect(picks(LOOP)).resolves.toEqual(["a", "b", "c", "a", "b"]);
    await expect(picks(SPECIAL)).resolves.toEqual(Array(5).fill("special"));
  });

  it("nulls a block's source when its unassigned collection is deleted", async () => {
    const db = await legacyLoops();
    await sourceAssignmentsMigration.up(db as Kysely<unknown>);
    await db
      .deleteFrom("programming_source_assignments")
      .where("channel_id", "=", LOOP)
      .execute();

    await db
      .deleteFrom("media_collections")
      .where("id", "=", collectionFixture.id)
      .execute();

    await expect(
      db
        .selectFrom("programming_blocks")
        .select([
          "assignment_id",
          "source_kind",
          "media_collection_id",
          "playback_mode",
        ])
        .where("id", "=", "block-loop")
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      assignment_id: null,
      source_kind: "collection",
      media_collection_id: null,
      playback_mode: "chronological",
    });
  });

  it("refuses an assigned collection's delete and a member in two assignments of a channel", async () => {
    const db = await legacyLoops();
    await sourceAssignmentsMigration.up(db as Kysely<unknown>);
    const assignment = await db
      .selectFrom("programming_source_assignments")
      .selectAll()
      .where("channel_id", "=", LOOP)
      .executeTakeFirstOrThrow();

    await expect(
      db
        .deleteFrom("media_collections")
        .where("id", "=", collectionFixture.id)
        .execute(),
    ).rejects.toThrow(/FOREIGN KEY/);
    await db
      .insertInto("programming_source_assignments")
      .values({ ...assignment, id: "second" })
      .execute();
    await expect(
      db
        .insertInto("programming_assignment_members")
        .values({
          assignment_id: "second",
          channel_id: LOOP,
          position: 0,
          source_kind: "collection",
          media_collection_id: collectionFixture.id,
          media_item_id: null,
          created_at: FIXTURE_TIME,
        })
        .execute(),
    ).rejects.toThrow(/UNIQUE/);
  });

  it("rolls back to one configured block per channel before any later turn", async () => {
    const db = await legacyLoops();
    const blocksBefore = await db
      .selectFrom("programming_blocks")
      .selectAll()
      .orderBy("id")
      .execute();
    const legacy = db as Kysely<unknown>;
    await sourceAssignmentsMigration.up(legacy);

    await sourceAssignmentsMigration.down?.(legacy);

    await expect(
      db.selectFrom("programming_blocks").selectAll().orderBy("id").execute(),
    ).resolves.toEqual(blocksBefore);
    const { rows } = await sql<{
      name: string;
    }>`select name from sqlite_master where type = 'table'
      and name in ('programming_source_assignments', 'programming_assignment_members', 'channel_programming_settings')`.execute(
      db,
    );
    expect(rows).toEqual([]);
  });

  it("refuses to roll back while a channel holds several blocks", async () => {
    const db = await legacyLoops();
    await sourceAssignmentsMigration.up(db as Kysely<unknown>);
    const block = await db
      .selectFrom("programming_blocks")
      .selectAll()
      .where("id", "=", "block-loop")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("programming_blocks")
      .values({ ...block, id: "block-loop-2", round_number: 2 })
      .execute();

    await expect(
      sourceAssignmentsMigration.down?.(db as Kysely<unknown>),
    ).rejects.toThrow(/UNIQUE/);
  });
});
