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

const EVERYTHING = { search: "", limit: 50, offset: 0 };

// Lists the IDs on one page so ordering and filtering assertions stay short.
async function listIds(
  repository: MediaItemRepository,
  query: Partial<typeof EVERYTHING>,
): Promise<string[]> {
  const page = await repository.list({ ...EVERYTHING, ...query });
  return page.items.map((entry) => entry.id);
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

    await expect(listIds(repository, {})).resolves.toEqual([
      "item-z",
      "item-a",
      "item-b",
    ]);
  });

  it("returns an empty page for an empty catalog", async () => {
    const repository = await setup([]);

    await expect(repository.list(EVERYTHING)).resolves.toEqual({
      items: [],
      total: 0,
    });
  });

  it("pages through the stable order while total counts every item", async () => {
    const repository = await setup(
      ["a", "b", "c", "d", "e"].map((name) =>
        itemFixtureAt(`item-${name}`, `/media/movies/${name}.mkv`),
      ),
    );

    const page = await repository.list({ ...EVERYTHING, limit: 2, offset: 2 });

    expect(page.items.map((entry) => entry.id)).toEqual(["item-c", "item-d"]);
    expect(page.total).toBe(5);
  });

  it("matches the search in a title or path, ignoring ASCII case", async () => {
    const repository = await setup([
      itemFixtureAt("item-title", "/media/movies/one.mkv", {
        title: "Northwoods Pilot",
      }),
      itemFixtureAt("item-path", "/media/movies/NORTHWOODS/two.mkv"),
      itemFixtureAt("item-other", "/media/movies/three.mkv"),
    ]);

    const page = await repository.list({ ...EVERYTHING, search: "northwoods" });

    expect(page.items.map((entry) => entry.id)).toEqual([
      "item-path",
      "item-title",
    ]);
    expect(page.total).toBe(2);
  });

  it("leaves excluded IDs out of the page and the total, beyond SQLite's parameter limit", async () => {
    const repository = await setup(
      ["a", "b", "c", "d"].map((name) =>
        itemFixtureAt(`item-${name}`, `/media/movies/${name}.mkv`),
      ),
    );
    const unknown = Array.from({ length: 40_000 }, (_, i) => `absent-${i}`);

    const page = await repository.list({
      ...EVERYTHING,
      limit: 1,
      offset: 1,
      excludeIds: ["item-a", "item-c", ...unknown],
    });

    expect(page.items.map((entry) => entry.id)).toEqual(["item-d"]);
    expect(page.total).toBe(2);
  });

  it("treats LIKE wildcards in the search as literal text", async () => {
    const repository = await setup([
      itemFixtureAt("item-percent", "/media/movies/100%.mkv"),
      itemFixtureAt("item-plain", "/media/movies/1000.mkv"),
    ]);

    await expect(listIds(repository, { search: "0%" })).resolves.toEqual([
      "item-percent",
    ]);
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
