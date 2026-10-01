import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { type Insertable, sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import { openDatabase, type KraziDatabase } from "./database.js";
import { migrateDatabase } from "./migrations/migrate-database.js";
import type { MediaCollectionItemTable } from "./schema/media-collection-item-table.js";
import type { MediaCollectionTable } from "./schema/media-collection-table.js";
import type { MediaItemTable } from "./schema/media-item-table.js";
import {
  collectionFixture,
  collectionItemFixture,
  itemFixture,
  rootFixture,
} from "../testing/catalog-fixtures.js";

const databases: KraziDatabase[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createTemporaryDataDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "krazitv-database-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function openTemporaryDatabase(): Promise<KraziDatabase> {
  const database = await openDatabase({
    dataDirectory: await createTemporaryDataDirectory(),
  });
  databases.push(database);
  return database;
}

describe("openDatabase", () => {
  it("creates and migrates a fresh database reproducibly", async () => {
    const dataDirectory = join(
      await createTemporaryDataDirectory(),
      "nested-data-directory",
    );
    const database = await openDatabase({ dataDirectory });
    databases.push(database);

    const tables = await sql<{ name: string }>`
      select name
      from sqlite_master
      where type = 'table'
      order by name
    `.execute(database.db);

    expect(tables.rows.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "kysely_migration",
        "kysely_migration_lock",
        "media_collection_items",
        "media_collections",
        "media_items",
        "media_roots",
      ]),
    );
    await expect(
      database.db.selectFrom("media_roots").selectAll().execute(),
    ).resolves.toEqual([]);
    await expect(
      database.db.selectFrom("media_items").selectAll().execute(),
    ).resolves.toEqual([]);

    await migrateDatabase(database.db);

    const migrations = await sql<{ count: number }>`
      select count(*) as count from kysely_migration
    `.execute(database.db);
    expect(migrations.rows[0]?.count).toBe(2);
  });

  it("reproduces the same logical schema in independent clean environments", async () => {
    const first = await openTemporaryDatabase();
    const second = await openTemporaryDatabase();

    const readSchema = async (database: KraziDatabase) => {
      const definitions = await sql<{
        name: string;
        sql: string;
      }>`
        select name, sql
        from sqlite_master
        where type = 'table'
          and name in (
            'media_collection_items',
            'media_collections',
            'media_items',
            'media_roots'
          )
        order by name
      `.execute(database.db);

      return definitions.rows.map(({ name, sql: definition }) => ({
        name,
        sql: definition.replace(/\s+/g, " ").trim(),
      }));
    };

    await expect(readSchema(first)).resolves.toEqual(await readSchema(second));
  });

  it("enables foreign-key enforcement", async () => {
    const database = await openTemporaryDatabase();

    const pragma = await sql<{
      foreign_keys: number;
    }>`pragma foreign_keys`.execute(database.db);
    expect(pragma.rows[0]?.foreign_keys).toBe(1);

    await expect(
      database.db
        .insertInto("media_items")
        .values({ ...itemFixture, media_root_id: "missing-root" })
        .execute(),
    ).rejects.toThrow(/foreign key constraint/i);
  });

  it("preserves data after closing and reopening the database", async () => {
    const dataDirectory = await createTemporaryDataDirectory();
    const first = await openDatabase({ dataDirectory });
    databases.push(first);
    await first.db.insertInto("media_roots").values(rootFixture).execute();
    await first.close();

    const reopened = await openDatabase({ dataDirectory });
    databases.push(reopened);
    await expect(
      reopened.db.selectFrom("media_roots").selectAll().execute(),
    ).resolves.toEqual([rootFixture]);
  });

  it("closes the Kysely connection and tolerates duplicate closes", async () => {
    const database = await openTemporaryDatabase();

    await database.close();
    await database.close();

    await expect(
      database.db.selectFrom("media_roots").selectAll().execute(),
    ).rejects.toThrow(/destroyed/i);
  });

  it("enforces root identity, boolean, and timestamp constraints", async () => {
    const database = await openTemporaryDatabase();
    await database.db.insertInto("media_roots").values(rootFixture).execute();

    await expect(
      database.db
        .insertInto("media_roots")
        .values({
          ...rootFixture,
          id: "root-duplicate-path",
          path: "/MEDIA/MOVIES",
        })
        .execute(),
    ).rejects.toThrow(/unique constraint/i);

    await expect(
      database.db
        .insertInto("media_roots")
        .values({ ...rootFixture, id: "root-invalid-enabled", enabled: 2 })
        .execute(),
    ).rejects.toThrow(/check constraint/i);

    await expect(
      database.db
        .insertInto("media_roots")
        .values({ ...rootFixture, id: "root-invalid-time", created_at: -1 })
        .execute(),
    ).rejects.toThrow(/check constraint/i);
  });

  it("enforces item identity and metadata constraints", async () => {
    const database = await openTemporaryDatabase();
    await database.db.insertInto("media_roots").values(rootFixture).execute();
    await database.db.insertInto("media_items").values(itemFixture).execute();

    const invalidItems: Insertable<MediaItemTable>[] = [
      { ...itemFixture, id: "item-duplicate-path" },
      {
        ...itemFixture,
        id: "item-invalid-status",
        path_key: "/media/movies/status.mkv",
        status: "invalid" as "available",
      },
      {
        ...itemFixture,
        id: "item-no-duration",
        path_key: "/media/movies/no-duration.mkv",
        duration_ms: null,
      },
      {
        ...itemFixture,
        id: "item-zero-duration",
        path_key: "/media/movies/zero-duration.mkv",
        duration_ms: 0,
      },
      {
        ...itemFixture,
        id: "item-fractional-duration",
        path_key: "/media/movies/fractional-duration.mkv",
        duration_ms: 1.5,
      },
      {
        ...itemFixture,
        id: "item-no-audio-presence",
        path_key: "/media/movies/no-audio-presence.mkv",
        has_audio: null,
      },
      {
        ...itemFixture,
        id: "item-available-error",
        path_key: "/media/movies/available-error.mkv",
        probe_error: "unexpected error",
      },
      {
        ...itemFixture,
        id: "item-probe-failed-no-error",
        path_key: "/media/movies/probe-failed-no-error.mkv",
        status: "probe_failed",
        duration_ms: null,
        has_audio: null,
      },
      {
        ...itemFixture,
        id: "item-probe-failed-empty-error",
        path_key: "/media/movies/probe-failed-empty-error.mkv",
        status: "probe_failed",
        duration_ms: null,
        has_audio: null,
        probe_error: "   ",
      },
      {
        ...itemFixture,
        id: "item-invalid-audio",
        path_key: "/media/movies/invalid-audio.mkv",
        has_audio: 2,
      },
      {
        ...itemFixture,
        id: "item-invalid-time",
        path_key: "/media/movies/invalid-time.mkv",
        last_seen_at: Number.MAX_SAFE_INTEGER + 1,
      },
    ];

    for (const item of invalidItems) {
      await expect(
        database.db.insertInto("media_items").values(item).execute(),
      ).rejects.toThrow(/constraint/i);
    }
  });

  it("allows missing items to retain successful metadata and diagnostics", async () => {
    const database = await openTemporaryDatabase();
    await database.db.insertInto("media_roots").values(rootFixture).execute();

    await expect(
      database.db
        .insertInto("media_items")
        .values({
          ...itemFixture,
          status: "missing",
          probe_error: "file was unavailable during the last probe",
        })
        .execute(),
    ).resolves.toBeDefined();
  });

  it("enforces collection name and timestamp constraints", async () => {
    const database = await openTemporaryDatabase();

    const invalidCollections: Insertable<MediaCollectionTable>[] = [
      { ...collectionFixture, id: "collection-empty-name", name: "" },
      { ...collectionFixture, id: "collection-blank-name", name: "   " },
      { ...collectionFixture, id: "collection-invalid-time", updated_at: -1 },
      {
        ...collectionFixture,
        id: "collection-fractional-time",
        created_at: 1.5,
      },
    ];

    for (const collection of invalidCollections) {
      await expect(
        database.db
          .insertInto("media_collections")
          .values(collection)
          .execute(),
      ).rejects.toThrow(/check constraint/i);
    }
  });

  it("enforces collection membership identity, order, and references", async () => {
    const database = await openTemporaryDatabase();
    await database.db.insertInto("media_roots").values(rootFixture).execute();
    await database.db
      .insertInto("media_items")
      .values([
        itemFixture,
        {
          ...itemFixture,
          id: "item-fixture-002",
          path_key: "/media/movies/second.mkv",
        },
      ])
      .execute();
    await database.db
      .insertInto("media_collections")
      .values(collectionFixture)
      .execute();
    await database.db
      .insertInto("media_collection_items")
      .values(collectionItemFixture)
      .execute();

    const second = {
      ...collectionItemFixture,
      media_item_id: "item-fixture-002",
    };
    const invalidMembers: [Insertable<MediaCollectionItemTable>, RegExp][] = [
      [{ ...collectionItemFixture, position: 1 }, /unique constraint/i],
      [second, /unique constraint/i],
      [{ ...second, position: -1 }, /check constraint/i],
      [{ ...second, position: 1.5 }, /check constraint/i],
      [
        { ...second, position: 1, created_at: Number.MAX_SAFE_INTEGER + 1 },
        /check constraint/i,
      ],
      [
        { ...second, media_item_id: "missing-item", position: 1 },
        /foreign key constraint/i,
      ],
      [
        { ...second, media_collection_id: "missing-collection", position: 1 },
        /foreign key constraint/i,
      ],
    ];

    for (const [member, failure] of invalidMembers) {
      await expect(
        database.db
          .insertInto("media_collection_items")
          .values(member)
          .execute(),
      ).rejects.toThrow(failure);
    }
  });

  it("indexes membership by media item so item-side lookups avoid a table scan", async () => {
    const database = await openTemporaryDatabase();

    const plan = await sql<{ detail: string }>`
      explain query plan
      select 1 from media_collection_items where media_item_id = 'item'
    `.execute(database.db);

    expect(plan.rows.map(({ detail }) => detail).join("\n")).toMatch(
      /SEARCH media_collection_items USING (COVERING )?INDEX media_collection_items_media_item_id/,
    );
  });

  it("deletes a collection's membership with the collection but keeps its items", async () => {
    const database = await openTemporaryDatabase();
    await database.db.insertInto("media_roots").values(rootFixture).execute();
    await database.db.insertInto("media_items").values(itemFixture).execute();
    await database.db
      .insertInto("media_collections")
      .values(collectionFixture)
      .execute();
    await database.db
      .insertInto("media_collection_items")
      .values(collectionItemFixture)
      .execute();

    await database.db
      .deleteFrom("media_collections")
      .where("id", "=", collectionFixture.id)
      .execute();

    await expect(
      database.db.selectFrom("media_collection_items").selectAll().execute(),
    ).resolves.toEqual([]);
    await expect(
      database.db.selectFrom("media_items").selectAll().execute(),
    ).resolves.toHaveLength(1);
  });
});

describe("development fixtures", () => {
  // There is no fixture loader: fixtures reach a database only when a test inserts
  // them, so no migration or other production module may import from testing/.
  it("are never imported by production source", async () => {
    const sourceRoot = fileURLToPath(new URL("..", import.meta.url));
    const productionFiles = (await readdir(sourceRoot, { recursive: true }))
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
      .filter((file) => !file.split(/[\\/]/).includes("testing"));

    const offenders: string[] = [];
    for (const file of productionFiles) {
      const source = await readFile(join(sourceRoot, file), "utf8");
      if (/["'`][^"'`]*\/testing\//.test(source)) offenders.push(file);
    }

    expect(productionFiles).toContain(
      join("database", "migrations", "migrate-database.ts"),
    );
    expect(productionFiles).toContain(
      join("database", "migrations", "001-initial-catalog.ts"),
    );
    expect(offenders).toEqual([]);
  });
});
