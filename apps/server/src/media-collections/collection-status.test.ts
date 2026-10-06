import { afterEach, expect, it } from "vitest";
import {
  cleanUpTestEnvironment,
  startTestServer,
} from "../testing/test-environment.js";
import { rootFixture, titledItemFixture } from "../testing/catalog-fixtures.js";

afterEach(cleanUpTestEnvironment);

it("reports backend schedulability for empty, missing, short and eligible members", async () => {
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
          titledItemFixture("eligible", { duration_ms: 1000 }),
        ])
        .execute();
    },
  });
  for (const [ids, expected] of [
    [[], false],
    [["short", "missing"], false],
    [["short", "eligible"], true],
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
    expect(response.json()).toMatchObject({
      schedulable: expected,
      memberCount: ids.length,
    });
  }
  expect(
    (await server.inject({ url: "/media-collections/absent/status" }))
      .statusCode,
  ).toBe(404);
});
