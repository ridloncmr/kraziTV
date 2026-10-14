import { afterEach, expect, it } from "vitest";

import { send, waitForMembers } from "../../testing/api-requests.js";
import { titledItemFixture } from "../../testing/catalog-fixtures.js";
import { movieFacts, seedEpisodes } from "../../testing/collection-fixtures.js";
import {
  cleanUpTestEnvironment,
  startTestServer,
} from "../../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

it("collects Christmas-tagged media, never untagged siblings, and follows untagging without touching a manual collection", async () => {
  const { server } = await startTestServer({
    seed: async (db) => {
      await seedEpisodes(db, [
        ["e1", 1, 1],
        ["e2", 1, 2],
      ]);
      await db
        .insertInto("media_items")
        .values(titledItemFixture("elf"))
        .execute();
      await db
        .insertInto("content_facts")
        .values(movieFacts("elf", null, "2003-10-09"))
        .execute();
    },
  });
  const tag = (id: string, tags: string[]) =>
    send(server, "PATCH", `/metadata/corrections/${id}`, { tags });
  expect((await tag("elf", ["Christmas"])).status).toBe(200);
  expect((await tag("e2", ["christmas"])).status).toBe(200);
  expect((await send(server, "GET", "/media-collections")).body).toEqual([]);

  const listed = await send(server, "GET", "/media-collections/tags");
  expect(listed.body).toEqual([
    { tagId: expect.any(String), name: "Christmas", itemCount: 2 },
  ]);
  const { tagId } = (listed.body as { tagId: string }[])[0];
  const christmas = await send(server, "POST", "/media-collections", {
    name: "Christmas",
    criterion: { kind: "tag", tagId },
  });
  const snapshot = await send(server, "POST", "/media-collections", {
    name: "Holiday snapshot",
    mediaItemIds: ["elf", "e2"],
  });
  expect(christmas.body).toMatchObject({ criterionLabel: "Christmas" });
  await waitForMembers(server, christmas.body.id as string, ["elf", "e2"], 0);

  await tag("e2", []);

  await waitForMembers(server, christmas.body.id as string, ["elf"]);
  await waitForMembers(server, snapshot.body.id as string, ["elf", "e2"], 0);
});
