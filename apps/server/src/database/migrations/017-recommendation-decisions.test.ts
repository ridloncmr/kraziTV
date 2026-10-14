import { afterEach, describe, expect, it } from "vitest";

import {
  collectionFixture,
  FIXTURE_TIME,
} from "../../testing/catalog-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

const DECISION = {
  criterion_key: '{"kind":"series","tmdbId":2316}',
  decision: "dismissed",
  media_collection_id: null,
  decided_at: FIXTURE_TIME,
} as const;

describe("017_recommendation_decisions", () => {
  it("stores one decision per criterion", async () => {
    const { db } = await openTestDatabase();

    await db
      .insertInto("collection_recommendation_decisions")
      .values(DECISION)
      .execute();

    await expect(
      db
        .selectFrom("collection_recommendation_decisions")
        .selectAll()
        .execute(),
    ).resolves.toEqual([DECISION]);
    await expect(
      db
        .insertInto("collection_recommendation_decisions")
        .values({ ...DECISION, decision: "accepted" })
        .execute(),
    ).rejects.toThrow(/UNIQUE|PRIMARY KEY/);
  });

  it("keeps an acceptance when its collection is deleted, unlinking the collection", async () => {
    const { db } = await openTestDatabase();
    await db
      .insertInto("media_collections")
      .values(collectionFixture)
      .execute();
    await db
      .insertInto("collection_recommendation_decisions")
      .values({
        ...DECISION,
        decision: "accepted",
        media_collection_id: collectionFixture.id,
      })
      .execute();

    await db.deleteFrom("media_collections").execute();

    await expect(
      db
        .selectFrom("collection_recommendation_decisions")
        .select(["decision", "media_collection_id"])
        .execute(),
    ).resolves.toEqual([{ decision: "accepted", media_collection_id: null }]);
  });

  it.each([
    [
      "a dismissal linked to a collection",
      { media_collection_id: collectionFixture.id },
    ],
    ["an unknown decision", { decision: "maybe" }],
    ["a criterion that is not a JSON object", { criterion_key: "series" }],
    ["a fractional decision time", { decided_at: 1.5 }],
  ])("refuses %s", async (_, override) => {
    const { db } = await openTestDatabase();
    await db
      .insertInto("media_collections")
      .values(collectionFixture)
      .execute();

    await expect(
      db
        .insertInto("collection_recommendation_decisions")
        // Typed as the valid row, since the override deliberately breaks it.
        .values({ ...DECISION, ...(override as object) })
        .execute(),
    ).rejects.toThrow(/CHECK constraint|malformed JSON/);
  });
});
