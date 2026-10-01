import { afterEach, describe, expect, it } from "vitest";

import { FIXTURE_TIME } from "../testing/catalog-fixtures.js";
import { MediaRootRepository } from "./media-root-repository.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../testing/test-environment.js";
import { sequentialIds } from "../testing/record-sources.js";

const LATER = FIXTURE_TIME + 60_000;

const movies = { path: "/media/Movies", pathKey: "/media/movies" };
const anime = { path: "/media/Anime", pathKey: "/media/anime" };

afterEach(cleanUpTestEnvironment);

// Opens a fresh migrated database with a repository on a controllable clock and sequential IDs.
async function setup() {
  const database = await openTestDatabase();
  const clock = { now: FIXTURE_TIME };
  const repository = new MediaRootRepository(database.db, {
    createId: sequentialIds("root"),
    now: () => clock.now,
  });
  return { repository, clock };
}

describe("MediaRootRepository.create", () => {
  it("returns the stored root with booleans and timestamps decoded", async () => {
    const { repository } = await setup();

    await expect(repository.create(movies, false)).resolves.toEqual({
      kind: "created",
      root: {
        id: "root-001",
        path: "/media/Movies",
        enabled: false,
        createdAt: FIXTURE_TIME,
        updatedAt: FIXTURE_TIME,
        lastScannedAt: null,
      },
    });
  });

  it("reports a duplicate when another root has the same path key", async () => {
    const { repository } = await setup();
    await repository.create(movies, true);

    await expect(
      repository.create(
        { path: "/media/MOVIES", pathKey: "/media/movies" },
        true,
      ),
    ).resolves.toEqual({ kind: "duplicate" });
    await expect(repository.list()).resolves.toHaveLength(1);
  });
});

describe("MediaRootRepository.list", () => {
  it("orders roots by path key, not insertion order or display casing", async () => {
    const { repository } = await setup();
    await repository.create(movies, true);
    await repository.create(anime, true);

    const roots = await repository.list();

    expect(roots.map((root) => root.path)).toEqual([
      "/media/Anime",
      "/media/Movies",
    ]);
  });
});

describe("MediaRootRepository.findById", () => {
  it("loads one root and returns undefined for an unknown ID", async () => {
    const { repository } = await setup();
    await repository.create(movies, true);

    await expect(repository.findById("root-001")).resolves.toMatchObject({
      id: "root-001",
      enabled: true,
    });
    await expect(repository.findById("root-missing")).resolves.toBeUndefined();
  });
});

describe("MediaRootRepository.setEnabled", () => {
  it("toggles the flag and bumps only updatedAt", async () => {
    const { repository, clock } = await setup();
    await repository.create(movies, true);
    clock.now = LATER;

    await expect(repository.setEnabled("root-001", false)).resolves.toEqual({
      id: "root-001",
      path: "/media/Movies",
      enabled: false,
      createdAt: FIXTURE_TIME,
      updatedAt: LATER,
      lastScannedAt: null,
    });
    await expect(repository.findById("root-001")).resolves.toMatchObject({
      enabled: false,
    });
  });

  it("returns undefined for an unknown ID", async () => {
    const { repository } = await setup();

    await expect(
      repository.setEnabled("root-missing", true),
    ).resolves.toBeUndefined();
  });
});
