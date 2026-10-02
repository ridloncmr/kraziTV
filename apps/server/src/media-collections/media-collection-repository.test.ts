import { afterEach, describe, expect, it } from "vitest";

import type { KraziDatabase } from "../database/database.js";
import {
  FIXTURE_TIME,
  itemFixture,
  rootFixture,
} from "../testing/catalog-fixtures.js";
import { MediaCollectionRepository } from "./media-collection-repository.js";
import {
  cleanUpTestEnvironment,
  createTemporaryDirectory,
  openTestDatabase,
} from "../testing/test-environment.js";
import { sequentialIds } from "../testing/record-sources.js";

afterEach(cleanUpTestEnvironment);

// Seeds one available, one missing, and one probe-failed item so membership can mix statuses.
async function seedCatalog(database: KraziDatabase): Promise<void> {
  await database.db.insertInto("media_roots").values(rootFixture).execute();
  await database.db
    .insertInto("media_items")
    .values([
      {
        ...itemFixture,
        id: "item-a",
        path_key: "/media/movies/a.mkv",
        title: "A",
      },
      {
        ...itemFixture,
        id: "item-b",
        path_key: "/media/movies/b.mkv",
        title: "B",
        status: "missing",
      },
      {
        ...itemFixture,
        id: "item-c",
        path_key: "/media/movies/c.mkv",
        title: "C",
        status: "probe_failed",
        duration_ms: null,
        has_audio: null,
        probe_error: "unreadable",
      },
    ])
    .execute();
}

// Creates a repository with a controllable clock and sequential IDs over a seeded database.
function createRepository(database: KraziDatabase) {
  const clock = { now: FIXTURE_TIME };
  const repository = new MediaCollectionRepository(database.db, {
    createId: sequentialIds("collection"),
    now: () => clock.now,
  });
  return { repository, clock };
}

// Opens a fresh migrated database with the seeded catalog and a deterministic repository.
async function setup() {
  const dataDirectory = await createTemporaryDirectory();
  const database = await openTestDatabase(dataDirectory);
  await seedCatalog(database);
  return { database, dataDirectory, ...createRepository(database) };
}

describe("MediaCollectionRepository", () => {
  it("creates an empty collection", async () => {
    const { repository } = await setup();

    await expect(repository.create("Halloween")).resolves.toEqual({
      kind: "created",
      collection: {
        id: "collection-001",
        name: "Halloween",
        createdAt: FIXTURE_TIME,
        updatedAt: FIXTURE_TIME,
      },
    });
    await expect(repository.listMembers("collection-001")).resolves.toEqual([]);
  });

  it("creates a collection with members in request order, including unavailable items", async () => {
    const { repository } = await setup();

    await repository.create("Mixed", ["item-c", "item-a", "item-b"]);

    await expect(repository.listMembers("collection-001")).resolves.toEqual([
      {
        position: 0,
        mediaItemId: "item-c",
        title: "C",
        status: "probe_failed",
        durationMs: null,
      },
      {
        position: 1,
        mediaItemId: "item-a",
        title: "A",
        status: "available",
        durationMs: 7_200_000,
      },
      {
        position: 2,
        mediaItemId: "item-b",
        title: "B",
        status: "missing",
        durationMs: 7_200_000,
      },
    ]);
  });

  it("rejects creation naming unknown items and stores nothing", async () => {
    const { repository } = await setup();

    await expect(
      repository.create("Bad", ["item-a", "ghost-2", "ghost-1"]),
    ).resolves.toEqual({
      kind: "unknown_media_items",
      mediaItemIds: ["ghost-2", "ghost-1"],
    });
    await expect(repository.list()).resolves.toEqual([]);
  });

  it("lists collections by case-folded name, then ID", async () => {
    const { repository } = await setup();
    await repository.create("beta");
    await repository.create("Alpha");
    await repository.create("alpha");
    await repository.create("Écran");
    await repository.create("Zulu");

    const names = (await repository.list()).map(
      ({ id, name }) => `${name}:${id}`,
    );

    expect(names).toEqual([
      "Alpha:collection-002",
      "alpha:collection-003",
      "beta:collection-001",
      "Écran:collection-004",
      "Zulu:collection-005",
    ]);
  });

  it("finds a collection by ID and returns undefined for unknown IDs", async () => {
    const { repository } = await setup();
    await repository.create("Movies");

    await expect(repository.findById("collection-001")).resolves.toMatchObject({
      id: "collection-001",
      name: "Movies",
    });
    await expect(repository.findById("unknown")).resolves.toBeUndefined();
  });

  it("renames a collection and advances only updatedAt", async () => {
    const { repository, clock } = await setup();
    await repository.create("Old");
    clock.now = FIXTURE_TIME + 1_000;

    await expect(repository.rename("collection-001", "New")).resolves.toEqual({
      id: "collection-001",
      name: "New",
      createdAt: FIXTURE_TIME,
      updatedAt: FIXTURE_TIME + 1_000,
    });
    await expect(repository.rename("unknown", "New")).resolves.toBeUndefined();
  });

  it("deletes a collection with its membership but not its media items", async () => {
    const { repository, database } = await setup();
    await repository.create("Doomed", ["item-a", "item-b"]);

    await expect(repository.delete("collection-001")).resolves.toBe(true);
    await expect(repository.delete("collection-001")).resolves.toBe(false);

    await expect(
      repository.findById("collection-001"),
    ).resolves.toBeUndefined();
    await expect(
      database.db.selectFrom("media_collection_items").selectAll().execute(),
    ).resolves.toEqual([]);
    await expect(
      database.db.selectFrom("media_items").selectAll().execute(),
    ).resolves.toHaveLength(3);
  });

  it("returns undefined members for an unknown collection", async () => {
    const { repository } = await setup();

    await expect(repository.listMembers("unknown")).resolves.toBeUndefined();
  });

  it("replaces membership with contiguous positions in request order", async () => {
    const { repository, clock, database } = await setup();
    await repository.create("Shows", ["item-a", "item-b", "item-c"]);
    clock.now = FIXTURE_TIME + 5_000;

    const result = await repository.replaceMembers("collection-001", [
      "item-b",
      "item-a",
    ]);

    expect(result).toEqual({
      kind: "replaced",
      members: [
        expect.objectContaining({ position: 0, mediaItemId: "item-b" }),
        expect.objectContaining({ position: 1, mediaItemId: "item-a" }),
      ],
    });
    await expect(repository.findById("collection-001")).resolves.toMatchObject({
      createdAt: FIXTURE_TIME,
      updatedAt: FIXTURE_TIME + 5_000,
    });
    const rows = await database.db
      .selectFrom("media_collection_items")
      .select(["media_item_id", "position", "created_at"])
      .orderBy("position")
      .execute();
    expect(rows).toEqual([
      {
        media_item_id: "item-b",
        position: 0,
        created_at: FIXTURE_TIME + 5_000,
      },
      {
        media_item_id: "item-a",
        position: 1,
        created_at: FIXTURE_TIME + 5_000,
      },
    ]);
  });

  it("replaces membership with an empty set", async () => {
    const { repository } = await setup();
    await repository.create("Shows", ["item-a"]);

    await expect(
      repository.replaceMembers("collection-001", []),
    ).resolves.toEqual({ kind: "replaced", members: [] });
  });

  it("reports an unknown collection when replacing membership", async () => {
    const { repository } = await setup();

    await expect(
      repository.replaceMembers("unknown", ["item-a"]),
    ).resolves.toEqual({ kind: "not_found" });
  });

  it("rejects replacement naming unknown items and keeps prior membership", async () => {
    const { repository } = await setup();
    await repository.create("Shows", ["item-a", "item-b"]);

    await expect(
      repository.replaceMembers("collection-001", ["item-c", "ghost"]),
    ).resolves.toEqual({
      kind: "unknown_media_items",
      mediaItemIds: ["ghost"],
    });

    const members = await repository.listMembers("collection-001");
    expect(members?.map(({ mediaItemId }) => mediaItemId)).toEqual([
      "item-a",
      "item-b",
    ]);
  });

  it("throws on duplicate members and keeps prior membership", async () => {
    const { repository } = await setup();
    await repository.create("Shows", ["item-a"]);

    await expect(
      repository.replaceMembers("collection-001", ["item-b", "item-b"]),
    ).rejects.toThrow(/unique constraint/i);
    await expect(
      repository.create("Dupes", ["item-a", "item-a"]),
    ).rejects.toThrow(/unique constraint/i);

    const members = await repository.listMembers("collection-001");
    expect(members?.map(({ mediaItemId }) => mediaItemId)).toEqual(["item-a"]);
    await expect(repository.list()).resolves.toHaveLength(1);
  });

  it("stores large memberships beyond SQLite's bound-parameter limit", async () => {
    const { repository, database } = await setup();
    const ids = Array.from(
      { length: 9_000 },
      (_, index) => `bulk-${String(index).padStart(5, "0")}`,
    );
    for (let start = 0; start < ids.length; start += 1_000) {
      await database.db
        .insertInto("media_items")
        .values(
          ids.slice(start, start + 1_000).map((id) => ({
            ...itemFixture,
            id,
            path_key: `/media/movies/${id}.mkv`,
          })),
        )
        .execute();
    }

    await expect(repository.create("Bulk", ids)).resolves.toMatchObject({
      kind: "created",
    });
    const members = await repository.listMembers("collection-001");
    expect(members).toHaveLength(9_000);
    expect(members?.at(-1)).toMatchObject({
      position: 8_999,
      mediaItemId: "bulk-08999",
    });
  });

  it("keeps collections and member order after closing and reopening the database", async () => {
    const { repository, database, dataDirectory } = await setup();
    await repository.create("Persistent", ["item-c", "item-a"]);
    await database.close();

    const reopened = await openTestDatabase(dataDirectory);
    const { repository: reopenedRepository } = createRepository(reopened);

    await expect(reopenedRepository.list()).resolves.toMatchObject([
      { id: "collection-001", name: "Persistent" },
    ]);
    const members = await reopenedRepository.listMembers("collection-001");
    expect(members?.map(({ mediaItemId }) => mediaItemId)).toEqual([
      "item-c",
      "item-a",
    ]);
  });
});
