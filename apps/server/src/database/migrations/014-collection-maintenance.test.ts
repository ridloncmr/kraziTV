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

const automatic = {
  ...collectionFixture,
  maintenance_mode: "automatic",
  criterion: '{"kind":"series","tmdbId":2316}',
} as const;

describe("014_collection_maintenance", () => {
  it("reads an existing collection back as manual, with no criterion or diagnostics", async () => {
    const { db } = await openTestDatabase();

    await db
      .insertInto("media_collections")
      .values(collectionFixture)
      .execute();

    await expect(
      db
        .selectFrom("media_collections")
        .select([
          "maintenance_mode",
          "criterion",
          "maintained_at",
          "maintenance_error",
          "maintenance_incomplete",
        ])
        .execute(),
    ).resolves.toEqual([
      {
        maintenance_mode: "manual",
        criterion: null,
        maintained_at: null,
        maintenance_error: null,
        maintenance_incomplete: null,
      },
    ]);
  });

  it("stores an automatic collection's criterion and maintenance diagnostics", async () => {
    const { db } = await openTestDatabase();
    const maintained = {
      ...automatic,
      maintained_at: FIXTURE_TIME,
      maintenance_error: "database is locked",
      maintenance_incomplete: 1,
    };

    await db.insertInto("media_collections").values(maintained).execute();

    await expect(
      db.selectFrom("media_collections").selectAll().execute(),
    ).resolves.toEqual([maintained]);
  });

  it.each([
    ["an unknown mode", { maintenance_mode: "paused" }],
    ["an automatic collection without a criterion", { criterion: null }],
    ["a manual collection with a criterion", { maintenance_mode: "manual" }],
    [
      "a manual collection with diagnostics",
      { maintenance_mode: "manual", criterion: null, maintained_at: 1 },
    ],
    ["a criterion that is not a JSON object", { criterion: '"series"' }],
    ["a fractional maintenance time", { maintained_at: 1.5 }],
    ["a blank maintenance error", { maintenance_error: " " }],
    ["an incomplete flag that is not 0 or 1", { maintenance_incomplete: 2 }],
  ])("refuses %s", async (_, override) => {
    const { db } = await openTestDatabase();

    await expect(
      db
        .insertInto("media_collections")
        // Typed as the valid row, since the override deliberately breaks it.
        .values({ ...automatic, ...(override as object) })
        .execute(),
    ).rejects.toThrow(/CHECK constraint/);
  });
});
