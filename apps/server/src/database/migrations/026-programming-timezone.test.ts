import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";
import { programmingTimezoneMigration } from "./026-programming-timezone.js";

afterEach(cleanUpTestEnvironment);

describe("026_programming_timezone", () => {
  it("leaves the timezone unrecorded until the first startup", async () => {
    const { db } = await openTestDatabase();
    const legacy = db as Kysely<unknown>;
    await programmingTimezoneMigration.down?.(legacy);

    await programmingTimezoneMigration.up(legacy);

    await expect(
      db.selectFrom("server_settings").select("programming_timezone").execute(),
    ).resolves.toEqual([{ programming_timezone: null }]);
  });

  it("refuses a blank timezone", async () => {
    const { db } = await openTestDatabase();

    await expect(
      db
        .updateTable("server_settings")
        .set({ programming_timezone: " " })
        .execute(),
    ).rejects.toThrow(/CHECK constraint/);
  });
});
