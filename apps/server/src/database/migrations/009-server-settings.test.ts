import { afterEach, describe, expect, it } from "vitest";

import {
  cleanUpTestEnvironment,
  openTestDatabase,
} from "../../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

describe("009_server_settings", () => {
  it("starts with the one settings row and no TMDB key", async () => {
    const { db } = await openTestDatabase();

    await expect(
      db.selectFrom("server_settings").selectAll().execute(),
    ).resolves.toEqual([{ id: 1, tmdb_api_key: null }]);
  });

  it("refuses a second settings row", async () => {
    const { db } = await openTestDatabase();

    await expect(
      db
        .insertInto("server_settings")
        .values({ id: 2, tmdb_api_key: null })
        .execute(),
    ).rejects.toThrow(/CHECK constraint/);
  });

  it("refuses a blank TMDB key", async () => {
    const { db } = await openTestDatabase();

    await expect(
      db.updateTable("server_settings").set({ tmdb_api_key: "  " }).execute(),
    ).rejects.toThrow(/CHECK constraint/);
  });
});
