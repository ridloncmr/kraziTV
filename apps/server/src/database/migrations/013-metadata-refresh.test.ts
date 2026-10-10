import { afterEach, describe, expect, it } from "vitest";

import { FIXTURE_TIME } from "../../testing/catalog-fixtures.js";
import {
  EPISODE_REF as REF,
  seededMetadataDatabase as seeded,
} from "../../testing/metadata-match-fixtures.js";
import { cleanUpTestEnvironment } from "../../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

describe("013_metadata_refresh", () => {
  it("starts a reference current, and stores a refresh error and expiry time", async () => {
    const db = await seeded();

    await db.insertInto("metadata_provider_refs").values(REF).execute();
    await expect(
      db
        .selectFrom("metadata_provider_refs")
        .select(["refresh_error", "expired_at"])
        .execute(),
    ).resolves.toEqual([{ refresh_error: null, expired_at: null }]);

    await db
      .updateTable("metadata_provider_refs")
      .set({
        refresh_error: "TMDB answered HTTP 404",
        expired_at: FIXTURE_TIME,
      })
      .execute();
    await expect(
      db
        .selectFrom("metadata_provider_refs")
        .select(["refresh_error", "expired_at"])
        .execute(),
    ).resolves.toEqual([
      { refresh_error: "TMDB answered HTTP 404", expired_at: FIXTURE_TIME },
    ]);
  });

  it.each([
    ["a blank refresh error", { refresh_error: " " }],
    ["a fractional expiry time", { expired_at: 1.5 }],
    ["a negative expiry time", { expired_at: -1 }],
  ])("refuses %s", async (_, override) => {
    const db = await seeded();

    await expect(
      db
        .insertInto("metadata_provider_refs")
        .values({ ...REF, ...override })
        .execute(),
    ).rejects.toThrow(/CHECK constraint/);
  });
});
