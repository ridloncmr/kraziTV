import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import { FIXTURE_TIME, itemFixture } from "../../testing/catalog-fixtures.js";
import { seededMetadataDatabase as seeded } from "../../testing/metadata-match-fixtures.js";
import { cleanUpTestEnvironment } from "../../testing/test-environment.js";
import { lookupErrorKindMigration } from "./035-lookup-error-kind.js";

afterEach(cleanUpTestEnvironment);

// A lookup that failed before kinds were stored: its text only.
const FAILED = {
  media_item_id: itemFixture.id,
  state: "unmatched",
  extra: 0,
  lookup_error: "TMDB answered HTTP 503",
  looked_up_at: FIXTURE_TIME,
  evidence: '{"title":"Alien"}',
  matched_duration_ms: null,
} as const;

describe("035_lookup_error_kind", () => {
  it("leaves a failure stored before it without a kind, keeping its text", async () => {
    const db = await seeded();
    const legacy = db as Kysely<unknown>;
    await lookupErrorKindMigration.down?.(legacy);
    await db.insertInto("metadata_matches").values(FAILED).execute();

    await lookupErrorKindMigration.up(legacy);

    await expect(
      db
        .selectFrom("metadata_matches")
        .select(["lookup_error", "lookup_error_kind"])
        .execute(),
    ).resolves.toEqual([
      { lookup_error: "TMDB answered HTTP 503", lookup_error_kind: null },
    ]);
  });

  it.each(["key_rejected", "unreachable", "http", "unreadable"] as const)(
    "stores the kind %s beside the failure's text",
    async (kind) => {
      const db = await seeded();

      await db
        .insertInto("metadata_matches")
        .values({ ...FAILED, lookup_error_kind: kind })
        .execute();

      await expect(
        db.selectFrom("metadata_matches").select("lookup_error_kind").execute(),
      ).resolves.toEqual([{ lookup_error_kind: kind }]);
    },
  );

  it.each([
    ["an unknown kind", { lookup_error_kind: "offline" }],
    ["a kind without a failure", { lookup_error: null, state: "matched" }],
  ])("refuses %s", async (_, override) => {
    const db = await seeded();

    await expect(
      db
        .insertInto("metadata_matches")
        .values({
          ...FAILED,
          lookup_error_kind: "http",
          ...override,
        } as unknown as typeof FAILED)
        .execute(),
    ).rejects.toThrow(/CHECK constraint/);
  });

  it("drops the kind on down and keeps the failure's text", async () => {
    const db = await seeded();
    await db
      .insertInto("metadata_matches")
      .values({ ...FAILED, lookup_error_kind: "key_rejected" })
      .execute();

    await lookupErrorKindMigration.down?.(db as Kysely<unknown>);

    await expect(
      db.selectFrom("metadata_matches").selectAll().execute(),
    ).resolves.toEqual([FAILED]);
  });
});
