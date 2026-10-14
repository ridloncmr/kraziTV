import { afterEach, expect, it } from "vitest";

import { CatalogRemovalService } from "../../catalog-removal/catalog-removal-service.js";
import type { MetadataRefreshService } from "../../content-metadata/refresh/metadata-refresh-service.js";
import { ScheduleService } from "../../schedules/schedule-service.js";
import { scannedLibrary } from "../../testing/metadata-refresh-fixtures.js";
import { RecordingCollectionMaintenance } from "../../testing/recording-collection-maintenance.js";
import { cleanUpTestEnvironment } from "../../testing/test-environment.js";
import { MediaCollectionRepository } from "../persistence/media-collection-repository.js";
import { CollectionMaintenance } from "./collection-maintenance.js";

const DAY_MS = 24 * 60 * 60 * 1_000;

const services: MetadataRefreshService[] = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.shutdown()));
  await cleanUpTestEnvironment();
});

/**
 * Scans a library holding one Firefly episode with the real TMDB refresh,
 * and creates an automatic Firefly collection over it, maintained by the
 * real service on the library's clock.
 */
async function fireflyLibrary() {
  const library = await scannedLibrary();
  services.push(library.refresh);
  const schedules = new ScheduleService(library.db, { now: library.clock.now });
  const maintenance = new CollectionMaintenance({
    db: library.db,
    schedules,
    log: library.log,
  });
  const collections = new MediaCollectionRepository(library.db, {
    now: library.clock.now,
  });
  const firefly = await collections.createAutomatic("Firefly", {
    kind: "series",
    tmdbId: library.firefly.id,
  });
  return { ...library, schedules, maintenance, collections, firefly };
}

type Library = Awaited<ReturnType<typeof fireflyLibrary>>;

// Reads the Firefly collection's members and whether maintenance was complete.
async function state({ db, collections, firefly }: Library) {
  const row = await db
    .selectFrom("media_collections")
    .select("maintenance_incomplete")
    .where("id", "=", firefly.id)
    .executeTakeFirstOrThrow();
  return {
    members: (await collections.listMembers(firefly.id))?.map(
      (member) => member.mediaItemId,
    ),
    incomplete: row.maintenance_incomplete === 1,
  };
}

// Expires the library's TMDB data: TMDB stays unreachable for six months.
async function expire(library: Library) {
  library.tmdb.unreachable = true;
  library.clock.advance(180 * DAY_MS);
  await library.refresh.refreshDue();
  await library.maintenance.request();
}

it("keeps an expired member and reports incomplete maintenance until a refresh restores its facts", async () => {
  const library = await fireflyLibrary();
  expect(await state(library)).toEqual({
    members: [library.episode],
    incomplete: false,
  });

  await expire(library);

  expect(await state(library)).toEqual({
    members: [library.episode],
    incomplete: true,
  });

  library.tmdb.unreachable = false;
  library.clock.advance(DAY_MS);
  await library.refresh.refreshDue();
  await library.maintenance.request();

  expect(await state(library)).toEqual({
    members: [library.episode],
    incomplete: false,
  });
});

it("still removes an expired member the owner removes from the catalog", async () => {
  const library = await fireflyLibrary();
  await expire(library);
  const removals = new CatalogRemovalService(library.db, {
    schedules: library.schedules,
    isScanning: () => false,
    collections: new RecordingCollectionMaintenance(),
  });

  await removals.remove(
    {
      target: { mediaItemIds: [library.episode] },
      airing: "finish",
      allowUnschedulable: false,
    },
    library.log,
  );
  await library.maintenance.request();

  expect(await state(library)).toEqual({ members: [], incomplete: false });
});
