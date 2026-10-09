import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { type Insertable, sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import type { KraziDatabase } from "./database.js";
import { migrateDatabase } from "./migrations/migrate-database.js";
import type { MediaCollectionItemTable } from "./schema/media-collection-item-table.js";
import type { MediaCollectionTable } from "./schema/media-collection-table.js";
import type { MediaItemTable } from "./schema/media-item-table.js";
import type { ProgrammingBlockTable } from "./schema/programming-block-table.js";
import {
  collectionFixture,
  collectionItemFixture,
  itemFixture,
  rootFixture,
} from "../testing/catalog-fixtures.js";
import {
  channelFixture,
  programmingBlockFixture,
} from "../testing/channel-fixtures.js";
import {
  cleanUpTestEnvironment,
  createTemporaryDirectory,
  openTestDatabase,
} from "../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

describe("openDatabase", () => {
  it("creates and migrates a fresh database reproducibly", async () => {
    const dataDirectory = join(
      await createTemporaryDirectory(),
      "nested-data-directory",
    );
    const database = await openTestDatabase(dataDirectory);

    const tables = await sql<{ name: string }>`
      select name
      from sqlite_master
      where type = 'table'
      order by name
    `.execute(database.db);

    expect(tables.rows.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "accounts",
        "channel_collection_progress",
        "channel_schedule_states",
        "channels",
        "kysely_migration",
        "kysely_migration_lock",
        "media_collection_items",
        "media_collections",
        "media_items",
        "media_roots",
        "programming_blocks",
        "schedule_entries",
        "server_settings",
        "sessions",
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
    expect(migrations.rows[0]?.count).toBe(9);
  });

  it("reproduces the same logical schema in independent clean environments", async () => {
    const first = await openTestDatabase();
    const second = await openTestDatabase();

    const readSchema = async (database: KraziDatabase) => {
      const definitions = await sql<{
        name: string;
        sql: string;
      }>`
        select name, sql
        from sqlite_master
        where type = 'table'
          and name in (
            'channels',
            'media_collection_items',
            'media_collections',
            'media_items',
            'media_roots',
            'programming_blocks'
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
    const database = await openTestDatabase();

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

  it("uses WAL and fails lock waits immediately by default", async () => {
    const database = await openTestDatabase();

    const journal = await sql<{
      journal_mode: string;
    }>`pragma journal_mode`.execute(database.db);
    const busy = await sql<{ timeout: number }>`pragma busy_timeout`.execute(
      database.db,
    );

    expect(journal.rows[0]?.journal_mode).toBe("wal");
    expect(busy.rows[0]?.timeout).toBe(0);
  });

  it("applies a configured busy timeout", async () => {
    const database = await openTestDatabase(undefined, { busyTimeoutMs: 25 });

    const busy = await sql<{ timeout: number }>`pragma busy_timeout`.execute(
      database.db,
    );
    expect(busy.rows[0]?.timeout).toBe(25);
  });

  it("preserves data after closing and reopening the database", async () => {
    const dataDirectory = await createTemporaryDirectory();
    const first = await openTestDatabase(dataDirectory);
    await first.db.insertInto("media_roots").values(rootFixture).execute();
    await first.close();

    const reopened = await openTestDatabase(dataDirectory);
    await expect(
      reopened.db.selectFrom("media_roots").selectAll().execute(),
    ).resolves.toEqual([rootFixture]);
  });

  it("closes the Kysely connection and tolerates duplicate closes", async () => {
    const database = await openTestDatabase();

    await database.close();
    await database.close();

    await expect(
      database.db.selectFrom("media_roots").selectAll().execute(),
    ).rejects.toThrow(/destroyed/i);
  });

  it("enforces root identity, boolean, and timestamp constraints", async () => {
    const database = await openTestDatabase();
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
    const database = await openTestDatabase();
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
    const database = await openTestDatabase();
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
    const database = await openTestDatabase();

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
    const database = await openTestDatabase();
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
    const database = await openTestDatabase();

    const plan = await sql<{ detail: string }>`
      explain query plan
      select 1 from media_collection_items where media_item_id = 'item'
    `.execute(database.db);

    expect(plan.rows.map(({ detail }) => detail).join("\n")).toMatch(
      /SEARCH media_collection_items USING (COVERING )?INDEX media_collection_items_media_item_id/,
    );
  });

  it("deletes a collection's membership with the collection but keeps its items", async () => {
    const database = await openTestDatabase();
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

  it("enforces a programming block's single, well-formed source", async () => {
    const database = await seedProgrammingInputs();
    const collectionBlock = programmingBlockFixture;
    const itemBlock: Insertable<ProgrammingBlockTable> = {
      ...programmingBlockFixture,
      source_kind: "media_item",
      media_collection_id: null,
      media_item_id: itemFixture.id,
      playback_mode: null,
    };

    const invalidBlocks: Insertable<ProgrammingBlockTable>[] = [
      { ...collectionBlock, media_collection_id: null },
      { ...itemBlock, media_item_id: null },
      { ...collectionBlock, media_item_id: itemFixture.id },
      { ...itemBlock, media_collection_id: collectionFixture.id },
      { ...collectionBlock, playback_mode: null },
      { ...itemBlock, playback_mode: "chronological" },
      { ...collectionBlock, playback_mode: "shuffle" as "random" },
      { ...collectionBlock, source_kind: "playlist" as "collection" },
      { ...collectionBlock, created_at: -1 },
      { ...collectionBlock, updated_at: 1.5 },
    ];

    for (const block of invalidBlocks) {
      await expect(
        database.db.insertInto("programming_blocks").values(block).execute(),
      ).rejects.toThrow(/check constraint/i);
    }
    await expect(
      database.db.insertInto("programming_blocks").values(itemBlock).execute(),
    ).resolves.toBeDefined();
  });

  it("allows one programming block per channel", async () => {
    const database = await seedProgrammingInputs();
    await database.db
      .insertInto("programming_blocks")
      .values(programmingBlockFixture)
      .execute();

    await expect(
      database.db
        .insertInto("programming_blocks")
        .values({ ...programmingBlockFixture, id: "block-second" })
        .execute(),
    ).rejects.toThrow(
      /unique constraint failed: programming_blocks\.channel_id/i,
    );
  });

  it("enforces programming block references", async () => {
    const database = await seedProgrammingInputs();

    const dangling: Insertable<ProgrammingBlockTable>[] = [
      { ...programmingBlockFixture, channel_id: "missing-channel" },
      { ...programmingBlockFixture, media_collection_id: "missing-collection" },
      {
        ...programmingBlockFixture,
        source_kind: "media_item",
        media_collection_id: null,
        media_item_id: "missing-item",
        playback_mode: null,
      },
    ];

    for (const block of dangling) {
      await expect(
        database.db.insertInto("programming_blocks").values(block).execute(),
      ).rejects.toThrow(/foreign key constraint/i);
    }
  });

  it("deletes a channel's programming block with the channel", async () => {
    const database = await seedProgrammingInputs();
    await database.db
      .insertInto("programming_blocks")
      .values(programmingBlockFixture)
      .execute();

    await database.db
      .deleteFrom("channels")
      .where("id", "=", channelFixture.id)
      .execute();

    await expect(
      database.db.selectFrom("programming_blocks").selectAll().execute(),
    ).resolves.toEqual([]);
  });

  it("rejects deleting a collection or item a programming block references", async () => {
    const database = await seedProgrammingInputs();
    await database.db
      .insertInto("programming_blocks")
      .values(programmingBlockFixture)
      .execute();
    await database.db
      .insertInto("channels")
      .values({ ...channelFixture, id: "channel-item", number: "70" })
      .execute();
    await database.db
      .insertInto("programming_blocks")
      .values({
        ...programmingBlockFixture,
        id: "block-item",
        channel_id: "channel-item",
        source_kind: "media_item",
        media_collection_id: null,
        media_item_id: itemFixture.id,
        playback_mode: null,
      })
      .execute();

    await expect(
      database.db
        .deleteFrom("media_collections")
        .where("id", "=", collectionFixture.id)
        .execute(),
    ).rejects.toThrow(/foreign key constraint/i);
    await expect(
      database.db
        .deleteFrom("media_items")
        .where("id", "=", itemFixture.id)
        .execute(),
    ).rejects.toThrow(/foreign key constraint/i);
  });

  it("indexes programming blocks by collection so in-use lookups avoid a table scan", async () => {
    const database = await openTestDatabase();

    const plan = await sql<{ detail: string }>`
      explain query plan
      select channel_id from programming_blocks where media_collection_id = 'c'
    `.execute(database.db);

    expect(plan.rows.map(({ detail }) => detail).join("\n")).toMatch(
      /SEARCH programming_blocks USING (COVERING )?INDEX programming_blocks_media_collection_id/,
    );
  });
});

/** Opens a database holding one channel, root, item, and collection for block rows to reference. */
async function seedProgrammingInputs(): Promise<KraziDatabase> {
  const database = await openTestDatabase();
  await database.db.insertInto("channels").values(channelFixture).execute();
  await database.db.insertInto("media_roots").values(rootFixture).execute();
  await database.db.insertInto("media_items").values(itemFixture).execute();
  await database.db
    .insertInto("media_collections")
    .values(collectionFixture)
    .execute();
  return database;
}

describe("development fixtures", () => {
  // There is no fixture loader: fixtures reach a database only when a test inserts
  // them, so no migration or other production module may import from testing/.
  it("are never imported by production source", async () => {
    const sourceRoot = fileURLToPath(new URL("..", import.meta.url));
    const productionFiles = (await readdir(sourceRoot, { recursive: true }))
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
      .filter((file) => !file.split(/[\\/]/).includes("testing"));

    // Reads concurrently: one file at a time made this I/O-bound test time out
    // when the whole suite competed for the disk.
    const sources = await Promise.all(
      productionFiles.map((file) => readFile(join(sourceRoot, file), "utf8")),
    );
    const offenders = productionFiles.filter((_, index) =>
      /["'`][^"'`]*\/testing\//.test(sources[index] ?? ""),
    );

    expect(productionFiles).toContain(
      join("database", "migrations", "migrate-database.ts"),
    );
    expect(productionFiles).toContain(
      join("database", "migrations", "001-initial-catalog.ts"),
    );
    expect(offenders).toEqual([]);
  });
});
