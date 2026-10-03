import {
  buildPlayoutTimeline,
  deriveChannelState,
  selectFollowingPlayout,
} from "@krazitv/krazi-brain";
import { afterEach, describe, expect, it } from "vitest";

import { FIXTURE_TIME } from "../testing/catalog-fixtures.js";
import { sequentialIds } from "../testing/record-sources.js";
import { recordingLog } from "../testing/recording-log.js";
import {
  readOnlyScheduleState,
  seedScheduleScenario,
} from "../testing/schedule-fixtures.js";
import { createBarrier } from "../testing/test-barrier.js";
import {
  cleanUpTestEnvironment,
  createTemporaryDirectory,
  openTestDatabase,
} from "../testing/test-environment.js";
import { ScheduleService } from "../schedules/schedule-service.js";
import type { PlayoutSnapshotRead } from "./contracts.js";
import {
  findCoveringPlayoutEntries,
  findPlayoutEntryById,
  listPlayoutEntriesAfter,
  listPlayoutEntriesInWindow,
} from "./playout-repository.js";
import { readPlayoutSnapshot } from "./playout-snapshot.js";

afterEach(cleanUpTestEnvironment);

const HOUR = 3_600_000;
const T0 = FIXTURE_TIME;
// Halfway through the first entry, so regeneration keeps it and rebuilds the rest.
const NOW = T0 + HOUR / 2;
const AIRING_ENTRY_ID = "original-001";
const FOLLOWING_COUNT = 3;

// What a read observed, reduced to the revision and the entry IDs it paired with it.
interface Observed {
  scheduleRevision: number;
  entryIds: string[];
}

// The current-state read: the airing entry and the item that follows it.
const readChannelState =
  (channelId: string): PlayoutSnapshotRead<Observed> =>
  async (trx, scheduleRevision) => {
    const state = deriveChannelState({
      channelId,
      scheduleRevision,
      evaluatedAt: NOW,
      entries: await findCoveringPlayoutEntries(trx, channelId, NOW),
    });
    if (state.kind !== "current") throw new Error(`no current: ${state.kind}`);
    return {
      scheduleRevision: state.scheduleRevision,
      entryIds: [
        state.currentItem.scheduleEntryId,
        state.nextItem?.scheduleEntryId ?? "none",
      ],
    };
  };

// The following read: the items after the airing entry, used as the cursor.
const readFollowing =
  (channelId: string): PlayoutSnapshotRead<Observed> =>
  async (trx, scheduleRevision) => {
    const cursor = await findPlayoutEntryById(trx, channelId, AIRING_ENTRY_ID);
    const candidates =
      cursor === undefined
        ? []
        : await listPlayoutEntriesAfter(
            trx,
            channelId,
            cursor.sequenceNumber,
            FOLLOWING_COUNT,
          );
    const following = selectFollowingPlayout({
      channelId,
      scheduleRevision,
      cursor: cursor?.entry,
      candidates,
      count: FOLLOWING_COUNT,
    });
    if (following.status !== "selected") {
      throw new Error(`not selected: ${following.status}`);
    }
    return {
      scheduleRevision: following.scheduleRevision,
      entryIds: following.items.map((item) => item.scheduleEntryId),
    };
  };

// The window read: every playable item in the three hours from T0.
const readWindow =
  (channelId: string): PlayoutSnapshotRead<Observed> =>
  async (trx, scheduleRevision) => {
    const items = buildPlayoutTimeline({
      channelId,
      scheduleRevision,
      entries: await listPlayoutEntriesInWindow(
        trx,
        channelId,
        T0,
        T0 + 3 * HOUR,
      ),
    });
    return {
      scheduleRevision,
      entryIds: items.map((item) => item.scheduleEntryId),
    };
  };

const READS = [
  {
    name: "current-state",
    read: readChannelState,
    before: ["original-001", "original-002"],
    after: ["original-001", "regenerated-001"],
  },
  {
    name: "following",
    read: readFollowing,
    before: ["original-002", "original-003", "original-004"],
    after: ["regenerated-001", "regenerated-002", "regenerated-003"],
  },
  {
    name: "window",
    read: readWindow,
    before: ["original-001", "original-002", "original-003"],
    after: ["original-001", "regenerated-001", "regenerated-002"],
  },
] as const;

/**
 * Covers a channel on the writer connection with `original-*` entries and
 * returns a reader on a second connection to the same file, because one
 * Kysely instance would serialize the two sides and hide the race.
 */
async function setup() {
  const dataDirectory = await createTemporaryDirectory();
  const writer = (await openTestDatabase(dataDirectory)).db;
  const reader = (await openTestDatabase(dataDirectory)).db;
  const { channelId } = await seedScheduleScenario(writer, {
    items: [{ durationMs: HOUR }, { durationMs: HOUR }, { durationMs: HOUR }],
    source: "chronological",
  });
  await new ScheduleService(writer, {
    now: () => T0,
    createId: sequentialIds("original"),
  }).ensureCoverage(channelId, recordingLog());
  const regenerator = new ScheduleService(writer, {
    now: () => NOW,
    createId: sequentialIds("regenerated"),
  });
  const regenerate = async () => {
    await regenerator.regenerate(channelId, recordingLog());
    return (await readOnlyScheduleState(writer)).schedule_revision;
  };
  const revisionBefore = (await readOnlyScheduleState(writer))
    .schedule_revision;
  return { reader, channelId, regenerate, revisionBefore };
}

describe("readPlayoutSnapshot across two connections", () => {
  describe.each(READS)("the $name read", ({ read, before, after }) => {
    it("returns the old revision with old IDs when regeneration commits mid-read", async () => {
      const { reader, channelId, regenerate, revisionBefore } = await setup();
      const barrier = createBarrier();

      const reading = readPlayoutSnapshot(
        reader,
        channelId,
        NOW,
        { coverage: { kind: "none" }, afterRevisionRead: () => barrier.wait() },
        read(channelId),
      );
      await barrier.reached;
      const revisionAfter = await regenerate();
      barrier.release();

      expect(revisionAfter).toBeGreaterThan(revisionBefore);
      await expect(reading).resolves.toEqual({
        kind: "ok",
        scheduleRevision: revisionBefore,
        value: { scheduleRevision: revisionBefore, entryIds: before },
      });
    });

    it("returns the new revision with new IDs when regeneration commits first", async () => {
      const { reader, channelId, regenerate } = await setup();
      const revisionAfter = await regenerate();

      await expect(
        readPlayoutSnapshot(
          reader,
          channelId,
          NOW,
          { coverage: { kind: "none" } },
          read(channelId),
        ),
      ).resolves.toEqual({
        kind: "ok",
        scheduleRevision: revisionAfter,
        value: { scheduleRevision: revisionAfter, entryIds: after },
      });
    });
  });
});
