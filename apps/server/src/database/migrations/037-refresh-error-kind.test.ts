import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import {
  EPISODE_REF,
  seededMetadataDatabase as seeded,
} from "../../testing/metadata-match-fixtures.js";
import { cleanUpTestEnvironment } from "../../testing/test-environment.js";
import { refreshErrorKindMigration } from "./037-refresh-error-kind.js";

afterEach(cleanUpTestEnvironment);

// A refresh that failed before kinds were stored: its text only.
const FAILED = {
  ...EPISODE_REF,
  refresh_error: "TMDB answered HTTP 503",
  expired_at: null,
} as const;

describe("037_refresh_error_kind", () => {
  it("leaves a refresh failure stored before it without a kind, keeping its text", async () => {
    const db = await seeded();
    const legacy = db as Kysely<unknown>;
    await refreshErrorKindMigration.down?.(legacy);
    await db.insertInto("metadata_provider_refs").values(FAILED).execute();

    await refreshErrorKindMigration.up(legacy);

    await expect(
      db
        .selectFrom("metadata_provider_refs")
        .select(["refresh_error", "refresh_error_kind"])
        .execute(),
    ).resolves.toEqual([
      { refresh_error: "TMDB answered HTTP 503", refresh_error_kind: null },
    ]);
  });

  it.each(["key_rejected", "unreachable", "http", "unreadable"] as const)(
    "stores the kind %s beside the refresh failure's text",
    async (kind) => {
      const db = await seeded();

      await db
        .insertInto("metadata_provider_refs")
        .values({ ...FAILED, refresh_error_kind: kind })
        .execute();

      await expect(
        db
          .selectFrom("metadata_provider_refs")
          .select("refresh_error_kind")
          .execute(),
      ).resolves.toEqual([{ refresh_error_kind: kind }]);
    },
  );

  it.each([
    ["an unknown kind", { refresh_error_kind: "offline" }],
    ["a kind without a failure", { refresh_error: null }],
  ])("refuses %s", async (_, override) => {
    const db = await seeded();

    await expect(
      db
        .insertInto("metadata_provider_refs")
        .values({
          ...FAILED,
          refresh_error_kind: "http",
          ...override,
        } as unknown as typeof FAILED)
        .execute(),
    ).rejects.toThrow(/CHECK constraint/);
  });

  it("drops the kind on down and keeps the refresh failure's text", async () => {
    const db = await seeded();
    await db
      .insertInto("metadata_provider_refs")
      .values({ ...FAILED, refresh_error_kind: "key_rejected" })
      .execute();

    await refreshErrorKindMigration.down?.(db as Kysely<unknown>);

    await expect(
      db.selectFrom("metadata_provider_refs").selectAll().execute(),
    ).resolves.toEqual([FAILED]);
  });
});
