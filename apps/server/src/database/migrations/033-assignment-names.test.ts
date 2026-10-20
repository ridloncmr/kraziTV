import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import {
  assignmentFixture,
  channelFixture,
} from "../../testing/channel-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";
import { assignmentNamesMigration } from "./033-assignment-names.js";

afterEach(cleanUpTestEnvironment);

describe("033_assignment_names", () => {
  it("leaves every existing assignment unnamed", async () => {
    const { db } = await openTestDatabase();
    await db.insertInto("channels").values(channelFixture).execute();
    const legacy = db as Kysely<unknown>;
    await assignmentNamesMigration.down?.(legacy);
    await db
      .insertInto("programming_source_assignments")
      .values(assignmentFixture)
      .execute();

    await assignmentNamesMigration.up(legacy);

    await expect(
      db.selectFrom("programming_source_assignments").select("name").execute(),
    ).resolves.toEqual([{ name: null }]);
  });

  it.each(["", "   ", "x".repeat(81)])(
    "refuses a blank or overlong name %j",
    async (name) => {
      const { db } = await openTestDatabase();
      await db.insertInto("channels").values(channelFixture).execute();

      await expect(
        db
          .insertInto("programming_source_assignments")
          .values({ ...assignmentFixture, name })
          .execute(),
      ).rejects.toThrow(/CHECK constraint/);
    },
  );
});
