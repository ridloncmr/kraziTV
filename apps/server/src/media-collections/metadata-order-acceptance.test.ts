import type { PlaybackMode } from "@krazitv/krazi-brain";
import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import { ScheduleService } from "../schedules/schedule-service.js";
import { createChannel, send } from "../testing/api-requests.js";
import { collectionAssignment } from "../testing/assignment-bodies.js";
import { channelFixture } from "../testing/channel-fixtures.js";
import {
  correct,
  idOf,
  scanThroughRoutes as scan,
  startEnrichmentServer,
} from "../testing/enrichment-scan.js";
import { manualClock } from "../testing/manual-clock.js";
import {
  changeAlien,
  scannedLibrary,
} from "../testing/metadata-refresh-fixtures.js";
import { recordingLog } from "../testing/recording-log.js";
import { readScheduleEntries } from "../testing/schedule-fixtures.js";
import { SCAN_FIREFLY } from "../testing/scan-metadata.js";
import { cleanUpTestEnvironment } from "../testing/test-environment.js";
import { CollectionMaintenance } from "./maintenance/collection-maintenance.js";
import { MediaCollectionRepository } from "./persistence/media-collection-repository.js";
import { insertCollectionAssignment } from "../testing/schedule-fixtures.js";

afterEach(cleanUpTestEnvironment);

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
const EPISODES = [
  "Firefly/Season 1/s01e01.mkv",
  "Firefly/Season 1/s01e02.mkv",
  "Firefly/Season 1/s01e03.mkv",
];

// Reads a channel's schedule revision.
async function revisionOf(db: Kysely<DatabaseSchema>, channelId: string) {
  const state = await db
    .selectFrom("channel_schedule_states")
    .select("schedule_revision")
    .where("channel_id", "=", channelId)
    .executeTakeFirstOrThrow();
  return state.schedule_revision;
}

// Creates a channel playing `collectionId` in `playbackMode` and returns its ID.
async function airCollection(
  server: FastifyInstance,
  number: string,
  collectionId: string,
  playbackMode: PlaybackMode,
): Promise<string> {
  const channel = await createChannel(server, { number, name: number });
  const { id } = channel.json<{ id: string }>();
  const block = await send(
    server,
    "POST",
    `/channels/${id}/programming-assignments`,
    collectionAssignment(collectionId, playbackMode),
  );
  expect(block.status).toBe(201);
  return id;
}

/**
 * Scans three hour-long Firefly episodes, saves them as e3, e1, e2, and airs
 * that collection in episode order on one channel and in collection order on
 * another. Hour-long files keep the airing entry steady on the real clock.
 */
async function fireflyChannels() {
  const context = await startEnrichmentServer({
    files: EPISODES,
    durations: new Map(EPISODES.map((file) => [file, HOUR_MS])),
  });
  context.tmdb.series.push(SCAN_FIREFLY);
  await scan(context.server);
  const { server } = context;
  const [e1, e2, e3] = (await Promise.all(
    EPISODES.map((file) => idOf(server, file)),
  )) as [string, string, string];
  const created = await send(server, "POST", "/media-collections", {
    name: "Firefly",
    mediaItemIds: [e3, e1, e2],
  });
  const collectionId = (created.body as { id: string }).id;
  const episodeOrder = await airCollection(
    server,
    "70",
    collectionId,
    "episode",
  );
  const savedOrder = await airCollection(
    server,
    "71",
    collectionId,
    "chronological",
  );
  return { ...context, e1, e2, e3, episodeOrder, savedOrder };
}

describe("metadata writes and active playback orders", () => {
  it("reorders an episode-order channel after a season correction, keeping the airing entry", async () => {
    const { server, db, dependencies, e1, e2, e3, episodeOrder, savedOrder } =
      await fireflyChannels();
    const [airing] = await readScheduleEntries(db, episodeOrder);
    expect(airing?.media_item_id).toBe(e1);
    const savedRevision = await revisionOf(db, savedOrder);

    // E2 moves to season 2, so e3 now follows the airing e1.
    expect((await correct(server, e2, { seasonNumber: 2 })).status).toBe(200);
    await dependencies.collectionMaintenance.request();

    const after = await readScheduleEntries(db, episodeOrder);
    expect(after[0]).toEqual(airing);
    expect(after.slice(1, 4).map((entry) => entry.media_item_id)).toEqual([
      e3,
      e2,
      e1,
    ]);
    await expect(revisionOf(db, savedOrder)).resolves.toBe(savedRevision);
  });

  it("leaves the schedule revision alone after a title correction", async () => {
    const { server, db, dependencies, e2, episodeOrder, savedOrder } =
      await fireflyChannels();
    const before = await Promise.all([
      revisionOf(db, episodeOrder),
      revisionOf(db, savedOrder),
    ]);

    expect((await correct(server, e2, { title: "The Train Job" })).status).toBe(
      200,
    );
    await dependencies.collectionMaintenance.request();

    await expect(
      Promise.all([revisionOf(db, episodeOrder), revisionOf(db, savedOrder)]),
    ).resolves.toEqual(before);
  });

  it("reorders a release-order channel after a refresh moves a release date", async () => {
    const library = await scannedLibrary();
    onTestFinished(() => library.refresh.shutdown());
    const { db, alien, episode, ambiguous } = library;
    // Hour-long items keep the horizon to a few dozen entries.
    await db.updateTable("media_items").set({ duration_ms: HOUR_MS }).execute();
    const scheduleClock = manualClock(library.clock.now());
    const schedules = new ScheduleService(db, { now: scheduleClock.now });
    const log = recordingLog();
    const maintenance = new CollectionMaintenance({ db, schedules, log });
    // Release order: Alien (1979), the episode (2002), then the undated title.
    const created = await new MediaCollectionRepository(db, {
      now: scheduleClock.now,
    }).create("Mixed", [ambiguous, episode, alien]);
    if (created.kind !== "created") throw new Error("collection not created");
    await db.insertInto("channels").values(channelFixture).execute();
    await insertCollectionAssignment(db, {
      mediaCollectionId: created.collection.id,
      playbackMode: "release",
    });
    await schedules.ensureCoverage(channelFixture.id, log);
    scheduleClock.advance(1_000);
    const [airing, next] = await readScheduleEntries(db, channelFixture.id);
    expect([airing?.media_item_id, next?.media_item_id]).toEqual([
      alien,
      episode,
    ]);

    // TMDB now dates Alien after the episode, so the undated title follows it.
    changeAlien(library, { releaseDate: "2005-06-01" });
    library.clock.advance(150 * DAY_MS);
    await library.refresh.refreshDue();
    expect(library.collections.requests).toBeGreaterThan(0);
    await maintenance.request();

    const after = await readScheduleEntries(db, channelFixture.id);
    expect(after[0]).toEqual(airing);
    expect(after.slice(1, 3).map((entry) => entry.media_item_id)).toEqual([
      ambiguous,
      episode,
    ]);
    expect(log.lines).toContainEqual(
      expect.objectContaining({
        fields: expect.objectContaining({ reason: "ordering_changed" }),
      }),
    );
  });
});
