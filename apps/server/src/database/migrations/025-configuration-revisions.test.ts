import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import { FIXTURE_TIME } from "../../testing/catalog-fixtures.js";
import { channelFixture } from "../../testing/channel-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";
import { configurationRevisionsMigration } from "./025-configuration-revisions.js";

afterEach(cleanUpTestEnvironment);

const SETTINGS = {
  channel_id: channelFixture.id,
  marathon_chance_percent: 10,
  marathon_min_ordinary_rounds: 2,
  created_at: FIXTURE_TIME,
  updated_at: FIXTURE_TIME,
};

describe("025_configuration_revisions", () => {
  it("starts existing channel settings at revision 0", async () => {
    const { db } = await openTestDatabase();
    await db.insertInto("channels").values(channelFixture).execute();
    const legacy = db as Kysely<unknown>;
    await configurationRevisionsMigration.down?.(legacy);
    await db
      .insertInto("channel_programming_settings")
      .values(SETTINGS)
      .execute();

    await configurationRevisionsMigration.up(legacy);

    await expect(
      db
        .selectFrom("channel_programming_settings")
        .select("configuration_revision")
        .execute(),
    ).resolves.toEqual([{ configuration_revision: 0 }]);
  });

  it("refuses a negative revision", async () => {
    const { db } = await openTestDatabase();
    await db.insertInto("channels").values(channelFixture).execute();

    await expect(
      db
        .insertInto("channel_programming_settings")
        .values({ ...SETTINGS, configuration_revision: -1 })
        .execute(),
    ).rejects.toThrow(/CHECK constraint/);
  });
});
