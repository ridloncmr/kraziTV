import type { Insertable } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import type { MediaItemTable } from "../database/schema/media-item-table.js";
import {
  FIXTURE_TIME,
  itemFixture,
  rootFixture,
} from "../testing/catalog-fixtures.js";
import { MediaItemRepository } from "./media-item-repository.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../testing/test-environment.js";

// A second root whose path key sorts before the fixture root's even though its ID sorts after.
const animeRoot = {
  ...rootFixture,
  id: "root-fixture-002",
  path: "/media/anime",
  path_key: "/media/anime",
};

afterEach(cleanUpTestEnvironment);

function item(
  id: string,
  mediaRootId: string,
  path: string,
  overrides: Partial<Insertable<MediaItemTable>> = {},
): Insertable<MediaItemTable> {
  return {
    ...itemFixture,
    id,
    media_root_id: mediaRootId,
    path,
    path_key: path,
    ...overrides,
  };
}

// Opens a fresh migrated database seeded with both roots and the given items.
async function setup(items: Insertable<MediaItemTable>[]) {
  const database = await openTestDatabase();
  await database.db
    .insertInto("media_roots")
    .values([rootFixture, animeRoot])
    .execute();
  if (items.length > 0) {
    await database.db.insertInto("media_items").values(items).execute();
  }
  return new MediaItemRepository(database.db);
}

describe("MediaItemRepository.list", () => {
  it("groups by root path key, then item path key", async () => {
    const repository = await setup([
      item("item-b", rootFixture.id, "/media/movies/b.mkv"),
      item("item-a", rootFixture.id, "/media/movies/a.mkv"),
      item("item-z", animeRoot.id, "/media/anime/z.mkv"),
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
      item("item-silent", rootFixture.id, "/media/movies/silent.mkv", {
        has_audio: 0,
      }),
    ]);

    await expect(repository.findById("item-silent")).resolves.toMatchObject({
      hasAudio: false,
    });
  });

  it("keeps unknown metadata of a probe failure as null", async () => {
    const repository = await setup([
      item("item-broken", rootFixture.id, "/media/movies/broken.mkv", {
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
