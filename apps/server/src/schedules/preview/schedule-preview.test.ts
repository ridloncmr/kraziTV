import { afterEach, describe, expect, it } from "vitest";

import { FIXTURE_TIME } from "../../testing/catalog-fixtures.js";
import { manualClock } from "../../testing/manual-clock.js";
import { sequentialIds } from "../../testing/record-sources.js";
import { recordingLog } from "../../testing/recording-log.js";
import {
  readScheduleEntries,
  seedScheduleScenario,
} from "../../testing/schedule-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";
import { ScheduleService } from "../schedule-service.js";
import { SchedulePreview } from "./schedule-preview.js";

afterEach(cleanUpTestEnvironment);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const EPISODES = [22, 23, 24].map((minutes) => ({
  durationMs: minutes * MINUTE,
}));
const T0 = FIXTURE_TIME;

// Seeds three chronological episodes and builds the writer and the preview on one manual clock.
async function setup() {
  const { db } = await openTestDatabase();
  const { channelId } = await seedScheduleScenario(db, {
    items: EPISODES,
    source: "chronological",
  });
  const clock = manualClock(T0);
  const service = new ScheduleService(db, {
    now: clock.now,
    createId: sequentialIds("entry"),
  });
  const preview = new SchedulePreview(db, clock.now, "UTC");
  return { db, channelId, service, preview, log: recordingLog() };
}

describe("SchedulePreview.readWindow", () => {
  it("returns every entry overlapping the window in start order, with the revision", async () => {
    const { db, channelId, service, preview, log } = await setup();
    await service.ensureCoverage(channelId, log);
    const [, second, third] = await readScheduleEntries(db, channelId);

    // Episodes run 0–22, 22–45, and 45–69 minutes past the anchor.
    const window = await preview.readWindow(
      channelId,
      T0 + 30 * MINUTE,
      T0 + 50 * MINUTE,
    );

    expect(window).toEqual({
      scheduleRevision: 1,
      fillerIntervals: [],
      entries: [second, third].map((row) => ({
        id: row.id,
        channelId,
        mediaItemId: row.media_item_id,
        title: row.title,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        durationMs: row.duration_ms,
        sequenceNumber: row.sequence_number,
        programmingBlockId: row.programming_block_id,
        mediaCollectionId: row.media_collection_id,
        playbackMode: row.playback_mode,
        playbackIndex: row.playback_index,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  });

  it("excludes entries that only touch the window's edges", async () => {
    const { channelId, service, preview, log } = await setup();
    await service.ensureCoverage(channelId, log);

    const window = await preview.readWindow(
      channelId,
      T0 + 22 * MINUTE,
      T0 + 45 * MINUTE,
    );

    expect(window.entries.map((entry) => entry.startsAt)).toEqual([
      T0 + 22 * MINUTE,
    ]);
  });

  it("reads no revision and no entries before the first generation", async () => {
    const { channelId, preview } = await setup();

    await expect(preview.readWindow(channelId, T0, T0 + HOUR)).resolves.toEqual(
      { scheduleRevision: null, entries: [], fillerIntervals: [] },
    );
  });
});
