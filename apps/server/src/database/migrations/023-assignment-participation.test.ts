import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import {
  channelFixture,
  assignmentFixture,
} from "../../testing/channel-fixtures.js";
import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";
import { assignmentParticipationMigration } from "./023-assignment-participation.js";

afterEach(cleanUpTestEnvironment);

describe("023_assignment_participation", () => {
  it("keeps every existing assignment in normal rotation", async () => {
    const { db } = await openTestDatabase();
    await db.insertInto("channels").values(channelFixture).execute();
    const legacy = db as Kysely<unknown>;
    await assignmentParticipationMigration.down?.(legacy);
    const { participation: _, ...legacyAssignment } = assignmentFixture;
    // Typed as a current row, since the legacy table has no participation yet.
    await db
      .insertInto("programming_source_assignments")
      .values(legacyAssignment as typeof assignmentFixture)
      .execute();

    await assignmentParticipationMigration.up(legacy);

    await expect(
      db
        .selectFrom("programming_source_assignments")
        .select("participation")
        .execute(),
    ).resolves.toEqual([{ participation: "default" }]);
  });

  it("refuses a participation other than default or rule_only", async () => {
    const { db } = await openTestDatabase();
    await db.insertInto("channels").values(channelFixture).execute();

    await expect(
      db
        .insertInto("programming_source_assignments")
        .values({
          ...assignmentFixture,
          participation: "sometimes" as "default",
        })
        .execute(),
    ).rejects.toThrow(/CHECK constraint/);
  });
});
