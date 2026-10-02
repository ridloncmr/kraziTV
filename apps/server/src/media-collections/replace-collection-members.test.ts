import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import type { DatabaseSchema } from "../database/schema/database-schema.js";
import { runImmediateTransaction } from "../database/writes/immediate-transaction.js";
import { FIXTURE_TIME, itemFixture } from "../testing/catalog-fixtures.js";
import { seedScheduleScenario } from "../testing/schedule-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../testing/test-environment.js";
import { replaceCollectionMembers } from "./replace-collection-members.js";

afterEach(cleanUpTestEnvironment);

const LATER = FIXTURE_TIME + 5_000;

// Seeds a collection whose members are item-001, item-002, and item-003, in that order.
async function setup() {
  const { db } = await openTestDatabase();
  const { collectionId } = await seedScheduleScenario(db, {
    items: [
      { durationMs: 1_000 },
      { durationMs: 1_000 },
      { durationMs: 1_000 },
    ],
    source: null,
  });
  return { db, collectionId };
}

// Replaces membership in its own transaction, as the schedule input change will.
function replace(
  db: Kysely<DatabaseSchema>,
  id: string,
  mediaItemIds: readonly string[],
) {
  return runImmediateTransaction(db, (trx) =>
    replaceCollectionMembers(trx, id, mediaItemIds, LATER),
  );
}

// Reads member IDs in position order.
async function memberIds(db: Kysely<DatabaseSchema>, id: string) {
  const rows = await db
    .selectFrom("media_collection_items")
    .select("media_item_id")
    .where("media_collection_id", "=", id)
    .orderBy("position")
    .execute();
  return rows.map((row) => row.media_item_id);
}

describe("replaceCollectionMembers", () => {
  it("replaces membership with contiguous positions in request order", async () => {
    const { db, collectionId } = await setup();

    const result = await replace(db, collectionId, ["item-002", "item-001"]);

    expect(result).toEqual({
      kind: "replaced",
      members: [
        expect.objectContaining({ position: 0, mediaItemId: "item-002" }),
        expect.objectContaining({ position: 1, mediaItemId: "item-001" }),
      ],
    });
    await expect(
      db
        .selectFrom("media_collections")
        .select(["created_at", "updated_at"])
        .executeTakeFirst(),
    ).resolves.toEqual({ created_at: FIXTURE_TIME, updated_at: LATER });
    await expect(
      db
        .selectFrom("media_collection_items")
        .select(["media_item_id", "position", "created_at"])
        .orderBy("position")
        .execute(),
    ).resolves.toEqual([
      { media_item_id: "item-002", position: 0, created_at: LATER },
      { media_item_id: "item-001", position: 1, created_at: LATER },
    ]);
  });

  it("replaces membership with an empty set", async () => {
    const { db, collectionId } = await setup();

    await expect(replace(db, collectionId, [])).resolves.toEqual({
      kind: "replaced",
      members: [],
    });
  });

  it("reports an unknown collection", async () => {
    const { db } = await setup();

    await expect(replace(db, "unknown", ["item-001"])).resolves.toEqual({
      kind: "not_found",
    });
  });

  it("rejects replacement naming unknown items and keeps prior membership", async () => {
    const { db, collectionId } = await setup();

    await expect(
      replace(db, collectionId, ["item-003", "ghost"]),
    ).resolves.toEqual({
      kind: "unknown_media_items",
      mediaItemIds: ["ghost"],
    });

    await expect(memberIds(db, collectionId)).resolves.toEqual([
      "item-001",
      "item-002",
      "item-003",
    ]);
  });

  it("throws on duplicate members, and the caller's rollback keeps prior membership", async () => {
    const { db, collectionId } = await setup();

    await expect(
      replace(db, collectionId, ["item-002", "item-002"]),
    ).rejects.toThrow(/unique constraint/i);

    await expect(memberIds(db, collectionId)).resolves.toEqual([
      "item-001",
      "item-002",
      "item-003",
    ]);
  });

  it("stores large memberships beyond SQLite's bound-parameter limit", async () => {
    const { db, collectionId } = await setup();
    const ids = Array.from(
      { length: 9_000 },
      (_, index) => `bulk-${String(index).padStart(5, "0")}`,
    );
    for (let start = 0; start < ids.length; start += 1_000) {
      await db
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

    const result = await replace(db, collectionId, ids);

    expect(result).toMatchObject({ kind: "replaced" });
    const members = result.kind === "replaced" ? result.members : [];
    expect(members).toHaveLength(9_000);
    expect(members.at(-1)).toMatchObject({
      position: 8_999,
      mediaItemId: "bulk-08999",
    });
  });
});
