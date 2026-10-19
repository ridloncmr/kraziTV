import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import {
  channelFixture,
  scheduleStateFixture,
} from "../../testing/channel-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";
import { programmingRevisionMigration } from "./030-programming-revision.js";

afterEach(cleanUpTestEnvironment);

describe("030_programming_revision", () => {
  it("stores the counter and refuses a negative one", async () => {
    const { db } = await openTestDatabase();
    await db.insertInto("channels").values(channelFixture).execute();
    await db
      .insertInto("channel_schedule_states")
      .values({ ...scheduleStateFixture, programming_revision: 3 })
      .execute();

    await expect(
      db
        .selectFrom("channel_schedule_states")
        .select("programming_revision")
        .execute(),
    ).resolves.toEqual([{ programming_revision: 3 }]);
    await db.deleteFrom("channel_schedule_states").execute();
    await expect(
      db
        .insertInto("channel_schedule_states")
        .values({ ...scheduleStateFixture, programming_revision: -1 })
        .execute(),
    ).rejects.toThrow(/CHECK constraint/);
  });

  it("starts an existing channel from its schedule revision when migrating up", async () => {
    const { db } = await openTestDatabase();
    const legacy = db as Kysely<unknown>;
    await db.insertInto("channels").values(channelFixture).execute();
    await programmingRevisionMigration.down?.(legacy);
    // The column is gone, so the row is inserted as the old shape.
    const { programming_revision: _, ...legacyState } = scheduleStateFixture;
    await db
      .insertInto("channel_schedule_states")
      .values({
        ...legacyState,
        schedule_revision: 5,
      } as typeof scheduleStateFixture)
      .execute();

    await programmingRevisionMigration.up(legacy);

    await expect(
      db
        .selectFrom("channel_schedule_states")
        .select(["schedule_revision", "programming_revision"])
        .execute(),
    ).resolves.toEqual([{ schedule_revision: 5, programming_revision: 5 }]);
  });
});
