import { afterEach, describe, expect, it } from "vitest";

import { FIXTURE_TIME } from "../../testing/catalog-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

const DECISION = {
  criterion_key: '{"kind":"series","tmdbId":2316}',
  decision: "dismissed",
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

  it.each([
    ["an unknown decision", { decision: "maybe" }],
    ["a criterion that is not a JSON object", { criterion_key: "series" }],
    ["a fractional decision time", { decided_at: 1.5 }],
  ])("refuses %s", async (_, override) => {
    const { db } = await openTestDatabase();

    await expect(
      db
        .insertInto("collection_recommendation_decisions")
        // Typed as the valid row, since the override deliberately breaks it.
        .values({ ...DECISION, ...(override as object) })
        .execute(),
    ).rejects.toThrow(/CHECK constraint|malformed JSON/);
  });
});
