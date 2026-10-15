import { afterEach, describe, expect, it } from "vitest";

import { WriteAuthorityBusyError } from "../database/writes/immediate-transaction.js";
import { send } from "../testing/api-requests.js";
import { collectionAssignment } from "../testing/assignment-bodies.js";
import { FIXTURE_TIME } from "../testing/catalog-fixtures.js";
import { assignmentFixture } from "../testing/channel-fixtures.js";
import {
  openRacingSchedule,
  racingRegenerator,
} from "../testing/racing-schedule.js";
import { recordingLog } from "../testing/recording-log.js";
import {
  assignmentsByRound,
  insertCollectionOfItems,
  readBlocks,
  readScheduleEntries,
} from "../testing/schedule-fixtures.js";
import { startScheduleScenarioServer } from "../testing/schedule-server.js";
import { createBarrier } from "../testing/test-barrier.js";
import { cleanUpTestEnvironment } from "../testing/test-environment.js";
import { AssignmentRepository } from "./persistence/assignment-repository.js";
import { assignmentChange } from "./writes/assignment-change.js";

afterEach(cleanUpTestEnvironment);

const MINUTE = 60_000;
const T0 = FIXTURE_TIME;
// The IDs seedScheduleScenario writes; its episodes run 22, 23, and 24 minutes.
const CHANNEL_ID = "channel-fixture-001";
const COLLECTION_ID = "collection-fixture-001";
const ASSIGNMENT_URL = `/channels/${CHANNEL_ID}/programming-assignments/${assignmentFixture.id}`;

// The scenario's three-episode turn, airing its second episode.
async function midTurnServer() {
  const context = await startScheduleScenarioServer();
  context.clock.set(T0 + 30 * MINUTE);
  const [turn] = await readBlocks(context.db);
  return { ...context, turnId: turn?.id };
}

describe("edits that end the started turn", () => {
  it("ends the turn after the airing program when its stretch changes, using the new size next", async () => {
    const { server, db, turnId } = await midTurnServer();
    const before = await readScheduleEntries(db, CHANNEL_ID);

    const response = await send(server, "PATCH", ASSIGNMENT_URL, {
      ...collectionAssignment(COLLECTION_ID),
      ordinaryStretch: { kind: "programs", count: 1 },
    });

    expect(response.status).toBe(200);
    const after = await readScheduleEntries(db, CHANNEL_ID);
    expect(after.slice(0, 2)).toEqual(before.slice(0, 2));
    // Without the edit, item-003 would finish the airing turn.
    expect(after[2]).toMatchObject({
      starts_at: T0 + 45 * MINUTE,
      media_item_id: "item-003",
    });
    expect(after[2]?.programming_block_id).not.toBe(turnId);
    const blocks = await readBlocks(db);
    expect(blocks[0]).toMatchObject({ id: turnId, ended_by_edit: 1 });
    expect(blocks[1]).toMatchObject({
      resolved_value: 1,
      round_number: 2,
      ended_by_edit: 0,
    });
  });

  it("keeps the started turn when only the members change", async () => {
    const { server, db, turnId } = await midTurnServer();
    await insertCollectionOfItems(db, "extra", [30 * MINUTE]);

    await send(server, "PATCH", ASSIGNMENT_URL, {
      ...collectionAssignment(COLLECTION_ID),
      members: [
        { kind: "collection", mediaCollectionId: COLLECTION_ID },
        { kind: "collection", mediaCollectionId: "extra" },
      ],
    });

    const after = await readScheduleEntries(db, CHANNEL_ID);
    expect(after[2]).toMatchObject({
      media_item_id: "item-003",
      programming_block_id: turnId,
    });
    await expect(readBlocks(db)).resolves.toContainEqual(
      expect.objectContaining({ id: turnId, ended_by_edit: 0 }),
    );
  });

  it("keeps the round when an assignment is added mid-round, granting no turn twice", async () => {
    const { server, db } = await startScheduleScenarioServer();
    await insertCollectionOfItems(db, "parks", Array(3).fill(30 * MINUTE));
    await insertCollectionOfItems(db, "scrubs", Array(3).fill(30 * MINUTE));
    const assignmentsUrl = `/channels/${CHANNEL_ID}/programming-assignments`;
    await send(server, "POST", assignmentsUrl, collectionAssignment("parks"));
    const roundBefore = (await readBlocks(db))[0]?.round_number;

    await send(server, "POST", assignmentsUrl, collectionAssignment("scrubs"));

    const blocks = await readBlocks(db);
    for (const round of assignmentsByRound(blocks).values()) {
      expect(new Set(round).size).toBe(round.length);
    }
    const scrubsId = (
      await db
        .selectFrom("programming_source_assignments")
        .select("id")
        .where("playback_mode", "=", "chronological")
        .orderBy("assignment_order", "desc")
        .executeTakeFirstOrThrow()
    ).id;
    const firstScrubs = blocks.find(
      (block) => block.assignment_id === scrubsId,
    );
    expect(firstScrubs?.round_number).toBeGreaterThan(roundBefore ?? 0);
  });

  it("acts on the committed edit when two edits race for write authority", async () => {
    const { writer, other, channelId } = await openRacingSchedule();
    const now = FIXTURE_TIME + 30 * MINUTE;
    const barrier = createBarrier();
    const edit = (count: number) =>
      assignmentChange(channelId, "updated", (trx, effectiveNow) =>
        new AssignmentRepository(trx).update(
          trx,
          channelId,
          assignmentFixture.id,
          {
            ...collectionAssignment(COLLECTION_ID),
            ordinaryStretch: { kind: "programs", count },
            playbackMode: "chronological",
            marathonStretch: null,
            members: [{ kind: "collection", mediaCollectionId: COLLECTION_ID }],
          },
          effectiveNow,
        ),
      );
    const first = racingRegenerator(writer, now, {
      afterBegin: () => barrier.wait(),
    });
    const second = racingRegenerator(other, now, {
      onBusy: () => barrier.release(),
    });

    const running = first.applyInputChange(
      recordingLog(),
      "assignment_changed",
      edit(1),
    );
    await barrier.reached;
    await Promise.resolve(
      second.applyInputChange(recordingLog(), "assignment_changed", edit(2)),
    ).catch((error: unknown) => {
      if (!(error instanceof WriteAuthorityBusyError)) throw error;
    });
    barrier.release();
    await running;

    const entries = await readScheduleEntries(writer, channelId);
    expect(new Set(entries.map((entry) => entry.sequence_number)).size).toBe(
      entries.length,
    );
    for (let index = 1; index < entries.length; index += 1) {
      expect(entries[index]?.starts_at).toBe(entries[index - 1]?.ends_at);
    }
    // The second edit read the first one's commit: its turn starts at the
    // airing episode's end with its own size, and the original turn ended.
    const settings = await writer
      .selectFrom("programming_source_assignments")
      .select("ordinary_min")
      .executeTakeFirstOrThrow();
    const blocks = await readBlocks(writer);
    expect(blocks[0]?.ended_by_edit).toBe(1);
    expect(blocks[1]).toMatchObject({
      starts_at: FIXTURE_TIME + 60 * MINUTE,
      resolved_value: settings.ordinary_min,
    });
  });
});
