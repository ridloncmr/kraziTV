import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import { runImmediateTransaction } from "../../database/writes/immediate-transaction.js";
import {
  collectionFixture,
  FIXTURE_TIME,
  itemFixture,
  rootFixture,
} from "../../testing/catalog-fixtures.js";
import { channelFixture } from "../../testing/channel-fixtures.js";
import { sequentialIds } from "../../testing/record-sources.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";
import { AssignmentRepository } from "./assignment-repository.js";
import type { AssignmentSettings } from "../contracts.js";

afterEach(cleanUpTestEnvironment);

const LATER = FIXTURE_TIME + 60_000;

const chronological: AssignmentSettings = {
  participation: "default",
  playbackMode: "chronological",
  ordinaryStretch: { kind: "programs", count: 3 },
  marathonStretch: null,
  members: [{ kind: "collection", mediaCollectionId: collectionFixture.id }],
};

const singleItem: AssignmentSettings = {
  participation: "default",
  playbackMode: null,
  ordinaryStretch: { kind: "programs", count: 1 },
  marathonStretch: null,
  members: [{ kind: "media_item", mediaItemId: itemFixture.id }],
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
  const repository = new AssignmentRepository(db, {
    createId: sequentialIds("assignment"),
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

describe("AssignmentRepository", () => {
  it("creates a collection assignment and lists it for its channel", async () => {
    const { db, repository } = await setup();

    const result = await write(db, (trx) =>
      repository.create(trx, channelFixture.id, chronological, FIXTURE_TIME),
    );

    const assignment = {
      id: "assignment-001",
      channelId: channelFixture.id,
      ...chronological,
      createdAt: FIXTURE_TIME,
      updatedAt: FIXTURE_TIME,
    };
    expect(result).toEqual({ kind: "created", assignment });
    await expect(repository.listForChannel(channelFixture.id)).resolves.toEqual(
      [assignment],
    );
    await expect(repository.listForChannel("channel-second")).resolves.toEqual(
      [],
    );
  });

  it("creates a single-item assignment", async () => {
    const { db, repository } = await setup();

    const result = await write(db, (trx) =>
      repository.create(trx, channelFixture.id, singleItem, FIXTURE_TIME),
    );

    expect(result).toMatchObject({
      kind: "created",
      assignment: singleItem,
    });
  });

  it("adds a second assignment after the first and refuses a member it already plays", async () => {
    const { db, repository } = await setup();
    await write(db, (trx) =>
      repository.create(trx, channelFixture.id, chronological, FIXTURE_TIME),
    );

    await write(db, (trx) =>
      repository.create(trx, channelFixture.id, singleItem, LATER),
    );
    const again = await write(db, (trx) =>
      repository.create(trx, channelFixture.id, chronological, LATER),
    );

    expect(again).toEqual({
      kind: "member_assigned",
      member: chronological.members[0],
      assignmentId: "assignment-001",
    });
    await expect(
      repository.listForChannel(channelFixture.id),
    ).resolves.toMatchObject([
      { id: "assignment-001", ...chronological },
      { id: "assignment-002", ...singleItem },
    ]);
    // Another channel may play the same member.
    await expect(
      write(db, (trx) =>
        repository.create(trx, "channel-second", chronological, LATER),
      ),
    ).resolves.toMatchObject({ kind: "created" });
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
          {
            ...chronological,
            members: [
              { kind: "collection", mediaCollectionId: "missing-collection" },
            ],
          },
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
          {
            ...singleItem,
            members: [{ kind: "media_item", mediaItemId: "missing-item" }],
          },
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

  it("replaces an assignment's settings and members and advances only updatedAt", async () => {
    const { db, repository } = await setup();
    await write(db, (trx) =>
      repository.create(trx, channelFixture.id, chronological, FIXTURE_TIME),
    );

    const result = await write(db, (trx) =>
      repository.update(
        trx,
        channelFixture.id,
        "assignment-001",
        singleItem,
        LATER,
      ),
    );

    const assignment = {
      id: "assignment-001",
      channelId: channelFixture.id,
      ...singleItem,
      createdAt: FIXTURE_TIME,
      updatedAt: LATER,
    };
    expect(result).toEqual({ kind: "updated", assignment });
    await expect(repository.listForChannel(channelFixture.id)).resolves.toEqual(
      [assignment],
    );
  });

  it.each([
    ["collection", chronological],
    ["single-item", singleItem],
  ])(
    "reports identical %s settings as unchanged without writing",
    async (_, source) => {
      const { db, repository } = await setup();
      const created = await write(db, (trx) =>
        repository.create(trx, channelFixture.id, source, FIXTURE_TIME),
      );

      const result = await write(db, (trx) =>
        repository.update(
          trx,
          channelFixture.id,
          "assignment-001",
          { ...source },
          LATER,
        ),
      );

      const assignment =
        created.kind === "created" ? created.assignment : undefined;
      expect(result).toEqual({ kind: "unchanged", assignment });
      await expect(
        repository.listForChannel(channelFixture.id),
      ).resolves.toEqual([assignment]);
    },
  );

  it("reports not_found when updating an unknown assignment or another channel's", async () => {
    const { db, repository } = await setup();
    await write(db, (trx) =>
      repository.create(trx, channelFixture.id, chronological, FIXTURE_TIME),
    );

    for (const [channelId, assignmentId] of [
      [channelFixture.id, "missing-assignment"],
      ["channel-second", "assignment-001"],
    ] as const) {
      await expect(
        write(db, (trx) =>
          repository.update(trx, channelId, assignmentId, singleItem, LATER),
        ),
      ).resolves.toEqual({ kind: "not_found" });
    }
  });

  it("reports an unknown member in an update and keeps the old settings", async () => {
    const { db, repository } = await setup();
    await write(db, (trx) =>
      repository.create(trx, channelFixture.id, singleItem, FIXTURE_TIME),
    );

    const result = await write(db, (trx) =>
      repository.update(
        trx,
        channelFixture.id,
        "assignment-001",
        {
          ...chronological,
          members: [
            { kind: "collection", mediaCollectionId: "missing-collection" },
          ],
        },
        LATER,
      ),
    );

    expect(result).toEqual({
      kind: "unknown_collection",
      mediaCollectionId: "missing-collection",
    });
    await expect(
      repository.listForChannel(channelFixture.id),
    ).resolves.toMatchObject([{ ...singleItem, updatedAt: FIXTURE_TIME }]);
    await expect(
      write(db, (trx) =>
        repository.update(
          trx,
          channelFixture.id,
          "assignment-001",
          {
            ...singleItem,
            members: [{ kind: "media_item", mediaItemId: "missing-item" }],
          },
          LATER,
        ),
      ),
    ).resolves.toEqual({
      kind: "unknown_media_item",
      mediaItemId: "missing-item",
    });
    await expect(
      repository.listForChannel(channelFixture.id),
    ).resolves.toMatchObject([{ ...singleItem, updatedAt: FIXTURE_TIME }]);
  });

  it("deletes an assignment only through its own channel", async () => {
    const { db, repository } = await setup();
    await write(db, (trx) =>
      repository.create(trx, channelFixture.id, chronological, FIXTURE_TIME),
    );

    await expect(
      write(db, (trx) =>
        repository.delete(trx, "channel-second", "assignment-001"),
      ),
    ).resolves.toEqual({ kind: "not_found" });
    await expect(
      write(db, (trx) =>
        repository.delete(trx, channelFixture.id, "assignment-001"),
      ),
    ).resolves.toEqual({ kind: "deleted" });
    await expect(
      write(db, (trx) =>
        repository.delete(trx, channelFixture.id, "assignment-001"),
      ),
    ).resolves.toEqual({ kind: "not_found" });
    await expect(repository.listForChannel(channelFixture.id)).resolves.toEqual(
      [],
    );
  });
});
