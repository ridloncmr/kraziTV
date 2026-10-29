import { afterEach, expect, it } from "vitest";

import {
  cleanUpTestEnvironment,
  startTestServer,
} from "../../testing/test-environment.js";
import {
  rootFixture,
  titledItemFixture,
} from "../../testing/catalog-fixtures.js";

afterEach(cleanUpTestEnvironment);

it("reports schedulability with the missing, could-not-read, and too-short counts for empty, missing, unreadable, short and eligible members", async () => {
  const { server } = await startTestServer({
    seed: async (db) => {
      await db.insertInto("media_roots").values(rootFixture).execute();
      await db
        .insertInto("media_items")
        .values([
          titledItemFixture("short", { duration_ms: 999 }),
          titledItemFixture("missing", {
            status: "missing",
            duration_ms: 2000,
          }),
          titledItemFixture("unreadable", {
            status: "probe_failed",
            duration_ms: null,
            probe_error: "Invalid data found when processing input",
          }),
          titledItemFixture("eligible", { duration_ms: 1000 }),
        ])
        .execute();
    },
  });
  for (const [ids, expected] of [
    [
      [],
      {
        schedulable: false,
        schedulableCount: 0,
        missingCount: 0,
        couldNotReadCount: 0,
        tooShortCount: 0,
      },
    ],
    [
      ["short", "missing"],
      {
        schedulable: false,
        schedulableCount: 0,
        missingCount: 1,
        couldNotReadCount: 0,
        tooShortCount: 1,
      },
    ],
    [
      ["unreadable"],
      {
        schedulable: false,
        schedulableCount: 0,
        missingCount: 0,
        couldNotReadCount: 1,
        tooShortCount: 0,
      },
    ],
    [
      ["short", "eligible"],
      {
        schedulable: true,
        schedulableCount: 1,
        missingCount: 0,
        couldNotReadCount: 0,
        tooShortCount: 1,
      },
    ],
  ] as const) {
    const created = await server.inject({
      method: "POST",
      url: "/media-collections",
      payload: { name: "Test", mediaItemIds: ids },
    });
    const { id } = created.json<{ id: string }>();
    const response = await server.inject({
      url: `/media-collections/${id}/status`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ...expected, memberCount: ids.length });
  }
  expect(
    (await server.inject({ url: "/media-collections/absent/status" }))
      .statusCode,
  ).toBe(404);
});
