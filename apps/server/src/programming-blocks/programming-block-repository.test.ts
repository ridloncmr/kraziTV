import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import { runImmediateTransaction } from "../database/writes/immediate-transaction.js";
import {
  collectionFixture,
  FIXTURE_TIME,
  itemFixture,
  rootFixture,
} from "../testing/catalog-fixtures.js";
import { channelFixture } from "../testing/channel-fixtures.js";
import { sequentialIds } from "../testing/record-sources.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../testing/test-environment.js";
import { findChannelsUsingCollection } from "./channels-using-collection.js";
import type { ProgrammingBlockSource } from "./contracts.js";
import { ProgrammingBlockRepository } from "./programming-block-repository.js";

afterEach(cleanUpTestEnvironment);

const LATER = FIXTURE_TIME + 60_000;

const chronological: ProgrammingBlockSource = {
  kind: "collection",
  mediaCollectionId: collectionFixture.id,
  playbackMode: "chronological",
};

const singleItem: ProgrammingBlockSource = {
  kind: "media_item",
  mediaItemId: itemFixture.id,
};

// Seeds two channels, one item, and one collection, and builds a repository with sequential IDs.
async function setup() {
  const { db } = await openTestDatabase();
  await db
    .insertInto("channels")
    .values([
      channelFixture,
      { ...channelFixture, id: "channel-second", number: "70" },
    ])
    .execute();
  await db.insertInto("media_roots").values(rootFixture).execute();
  await db.insertInto("media_items").values(itemFixture).execute();
  await db.insertInto("media_collections").values(collectionFixture).execute();
  const repository = new ProgrammingBlockRepository(db, {
    createId: sequentialIds("block"),
  });
  return { db, repository };
}

// Runs one write the way ScheduleService will: inside an immediate transaction.
function write<T>(
  db: Kysely<DatabaseSchema>,
  work: (pinned: Kysely<DatabaseSchema>) => Promise<T>,
): Promise<T> {
  return runImmediateTransaction(db, work);
}

describe("ProgrammingBlockRepository", () => {
  it("creates a collection-sourced block and lists it for its channel", async () => {
    const { db, repository } = await setup();

    const result = await write(db, (trx) =>
      repository.create(trx, channelFixture.id, chronological, FIXTURE_TIME),
    );

    const block = {
      id: "block-001",
      channelId: channelFixture.id,
      source: chronological,
      createdAt: FIXTURE_TIME,
      updatedAt: FIXTURE_TIME,
    };
    expect(result).toEqual({ kind: "created", block });
    await expect(repository.listForChannel(channelFixture.id)).resolves.toEqual(
      [block],
    );
    await expect(repository.listForChannel("channel-second")).resolves.toEqual(
      [],
    );
  });

  it("creates a single-item block", async () => {
    const { db, repository } = await setup();

    const result = await write(db, (trx) =>
      repository.create(trx, channelFixture.id, singleItem, FIXTURE_TIME),
    );

    expect(result).toMatchObject({
      kind: "created",
      block: { source: singleItem },
    });
  });

  it("reports limit_reached for a second block on one channel", async () => {
    const { db, repository } = await setup();
    await write(db, (trx) =>
      repository.create(trx, channelFixture.id, chronological, FIXTURE_TIME),
    );

    const result = await write(db, (trx) =>
      repository.create(trx, channelFixture.id, singleItem, LATER),
    );

    expect(result).toEqual({ kind: "limit_reached" });
    await expect(
      repository.listForChannel(channelFixture.id),
    ).resolves.toHaveLength(1);
  });

  it("reports channel_not_found for an unknown channel", async () => {
    const { db, repository } = await setup();

    const result = await write(db, (trx) =>
      repository.create(trx, "missing-channel", chronological, FIXTURE_TIME),
    );

    expect(result).toEqual({ kind: "channel_not_found" });
  });

  it("reports an unknown collection or media item without writing", async () => {
    const { db, repository } = await setup();

    await expect(
      write(db, (trx) =>
        repository.create(
          trx,
          channelFixture.id,
          { ...chronological, mediaCollectionId: "missing-collection" },
          FIXTURE_TIME,
        ),
      ),
    ).resolves.toEqual({
      kind: "unknown_collection",
      mediaCollectionId: "missing-collection",
    });
    await expect(
      write(db, (trx) =>
        repository.create(
          trx,
          channelFixture.id,
          { kind: "media_item", mediaItemId: "missing-item" },
          FIXTURE_TIME,
        ),
      ),
    ).resolves.toEqual({
      kind: "unknown_media_item",
      mediaItemId: "missing-item",
    });
    await expect(repository.listForChannel(channelFixture.id)).resolves.toEqual(
      [],
    );
  });

  it("replaces a block's source and advances only updatedAt", async () => {
    const { db, repository } = await setup();
    await write(db, (trx) =>
      repository.create(trx, channelFixture.id, chronological, FIXTURE_TIME),
    );

    const result = await write(db, (trx) =>
      repository.replaceSource(
        trx,
        channelFixture.id,
        "block-001",
        singleItem,
        LATER,
      ),
    );

    const block = {
      id: "block-001",
      channelId: channelFixture.id,
      source: singleItem,
      createdAt: FIXTURE_TIME,
      updatedAt: LATER,
    };
    expect(result).toEqual({ kind: "replaced", block });
    await expect(repository.listForChannel(channelFixture.id)).resolves.toEqual(
      [block],
    );
  });

  it.each([
    ["collection", chronological],
    ["single-item", singleItem],
  ])(
    "reports an identical %s source as unchanged without writing",
    async (_, source) => {
      const { db, repository } = await setup();
      const created = await write(db, (trx) =>
        repository.create(trx, channelFixture.id, source, FIXTURE_TIME),
      );

      const result = await write(db, (trx) =>
        repository.replaceSource(
          trx,
          channelFixture.id,
          "block-001",
          { ...source },
          LATER,
        ),
      );

      const block = created.kind === "created" ? created.block : undefined;
      expect(result).toEqual({ kind: "unchanged", block });
      await expect(
        repository.listForChannel(channelFixture.id),
      ).resolves.toEqual([block]);
    },
  );

  it("reports not_found when replacing an unknown block or another channel's block", async () => {
    const { db, repository } = await setup();
    await write(db, (trx) =>
      repository.create(trx, channelFixture.id, chronological, FIXTURE_TIME),
    );

    for (const [channelId, blockId] of [
      [channelFixture.id, "missing-block"],
      ["channel-second", "block-001"],
    ] as const) {
      await expect(
        write(db, (trx) =>
          repository.replaceSource(trx, channelId, blockId, singleItem, LATER),
        ),
      ).resolves.toEqual({ kind: "not_found" });
    }
  });

  it("reports an unknown replacement source and keeps the old one", async () => {
    const { db, repository } = await setup();
    await write(db, (trx) =>
      repository.create(trx, channelFixture.id, singleItem, FIXTURE_TIME),
    );

    const result = await write(db, (trx) =>
      repository.replaceSource(
        trx,
        channelFixture.id,
        "block-001",
        { ...chronological, mediaCollectionId: "missing-collection" },
        LATER,
      ),
    );

    expect(result).toEqual({
      kind: "unknown_collection",
      mediaCollectionId: "missing-collection",
    });
    await expect(
      repository.listForChannel(channelFixture.id),
    ).resolves.toMatchObject([{ source: singleItem, updatedAt: FIXTURE_TIME }]);
    await expect(
      write(db, (trx) =>
        repository.replaceSource(
          trx,
          channelFixture.id,
          "block-001",
          { kind: "media_item", mediaItemId: "missing-item" },
          LATER,
        ),
      ),
    ).resolves.toEqual({
      kind: "unknown_media_item",
      mediaItemId: "missing-item",
    });
    await expect(
      repository.listForChannel(channelFixture.id),
    ).resolves.toMatchObject([{ source: singleItem, updatedAt: FIXTURE_TIME }]);
  });

  it("deletes a block only through its own channel", async () => {
    const { db, repository } = await setup();
    await write(db, (trx) =>
      repository.create(trx, channelFixture.id, chronological, FIXTURE_TIME),
    );

    await expect(
      write(db, (trx) => repository.delete(trx, "channel-second", "block-001")),
    ).resolves.toEqual({ kind: "not_found" });
    await expect(
      write(db, (trx) =>
        repository.delete(trx, channelFixture.id, "block-001"),
      ),
    ).resolves.toEqual({ kind: "deleted" });
    await expect(
      write(db, (trx) =>
        repository.delete(trx, channelFixture.id, "block-001"),
      ),
    ).resolves.toEqual({ kind: "not_found" });
    await expect(repository.listForChannel(channelFixture.id)).resolves.toEqual(
      [],
    );
  });
});

describe("findChannelsUsingCollection", () => {
  it("lists every channel whose block draws from the collection, in ID order", async () => {
    const { db, repository } = await setup();
    await write(db, async (trx) => {
      await repository.create(trx, "channel-second", chronological, LATER);
      await repository.create(
        trx,
        channelFixture.id,
        { ...chronological, playbackMode: "random" },
        LATER,
      );
    });

    await expect(
      findChannelsUsingCollection(db, collectionFixture.id),
    ).resolves.toEqual([channelFixture.id, "channel-second"]);
    await expect(
      findChannelsUsingCollection(db, "unused-collection"),
    ).resolves.toEqual([]);
  });
});
