import type { Insertable } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import type { MediaItemTable } from "../database/schema/media-item-table.js";
import {
  animeRootFixture,
  FIXTURE_TIME,
  itemFixture,
  itemFixtureAt,
  rootFixture,
} from "../testing/catalog-fixtures.js";
import { MediaItemRepository } from "./media-item-repository.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

// Opens a fresh migrated database seeded with both roots and the given items.
async function setup(items: Insertable<MediaItemTable>[]) {
  const database = await openTestDatabase();
  await database.db
    .insertInto("media_roots")
    .values([rootFixture, animeRootFixture])
    .execute();
  if (items.length > 0) {
    await database.db.insertInto("media_items").values(items).execute();
  }
  return new MediaItemRepository(database.db);
}

describe("MediaItemRepository.list", () => {
  it("groups by root path key, then item path key", async () => {
    const repository = await setup([
      itemFixtureAt("item-b", "/media/movies/b.mkv"),
      itemFixtureAt("item-a", "/media/movies/a.mkv"),
      itemFixtureAt("item-z", "/media/anime/z.mkv", {
        media_root_id: animeRootFixture.id,
      }),
    ]);

    const items = await repository.list();

    expect(items.map((entry) => entry.id)).toEqual([
      "item-z",
      "item-a",
      "item-b",
    ]);
  });

  it("returns an empty list for an empty catalog", async () => {
    const repository = await setup([]);

    await expect(repository.list()).resolves.toEqual([]);
  });
});

describe("MediaItemRepository.findById", () => {
  it("decodes every column into the domain record", async () => {
    const repository = await setup([itemFixture]);

    await expect(repository.findById(itemFixture.id)).resolves.toEqual({
      id: "item-fixture-001",
      mediaRootId: "root-fixture-001",
      path: "/media/movies/example.mkv",
      title: "Example",
      durationMs: 7_200_000,
      hasAudio: true,
      hasVideo: true,
      status: "available",
      probeError: null,
      createdAt: FIXTURE_TIME,
      updatedAt: FIXTURE_TIME,
      lastSeenAt: FIXTURE_TIME,
      lastProbedAt: FIXTURE_TIME,
    });
  });

  it("decodes a silent file's has_audio as false", async () => {
    const repository = await setup([
      itemFixtureAt("item-silent", "/media/movies/silent.mkv", {
        has_audio: 0,
      }),
    ]);

    await expect(repository.findById("item-silent")).resolves.toMatchObject({
      hasAudio: false,
    });
  });

  it("decodes an audio-only file's has_video as false and an unscanned fact as null", async () => {
    const repository = await setup([
      itemFixtureAt("item-audio-only", "/media/movies/audio-only.mkv", {
        has_video: 0,
      }),
      itemFixtureAt("item-before-video", "/media/movies/before-video.mkv", {
        has_video: null,
      }),
    ]);

    await expect(repository.findById("item-audio-only")).resolves.toMatchObject(
      { hasVideo: false },
    );
    await expect(
      repository.findById("item-before-video"),
    ).resolves.toMatchObject({ hasVideo: null });
  });

  it("keeps unknown metadata of a probe failure as null", async () => {
    const repository = await setup([
      itemFixtureAt("item-broken", "/media/movies/broken.mkv", {
        status: "probe_failed",
        duration_ms: null,
        has_audio: null,
        probe_error: "ffprobe could not read the file",
      }),
    ]);

    await expect(repository.findById("item-broken")).resolves.toMatchObject({
      durationMs: null,
      hasAudio: null,
      status: "probe_failed",
      probeError: "ffprobe could not read the file",
    });
  });

  it("returns undefined for an unknown ID", async () => {
    const repository = await setup([]);

    await expect(repository.findById("item-missing")).resolves.toBeUndefined();
  });
});
