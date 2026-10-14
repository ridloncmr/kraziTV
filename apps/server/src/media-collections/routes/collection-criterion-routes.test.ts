import { afterEach, describe, expect, it } from "vitest";

import { send } from "../../testing/api-requests.js";
import {
  episodeFacts,
  seedEpisodes,
} from "../../testing/collection-fixtures.js";
import { titledItemFixture } from "../../testing/catalog-fixtures.js";
import {
  cleanUpTestEnvironment,
  startTestServer,
} from "../../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

const OFFICE = { kind: "series", tmdbId: 2316 } as const;
const PARKS = { kind: "series", tmdbId: 8592 } as const;

/**
 * Boots a server cataloging three Office and two Parks episodes, with an
 * automatic Office collection that excludes the second Office episode.
 */
async function startServer() {
  const started = await startTestServer({
    seed: async (db) => {
      await seedEpisodes(db, [
        ["e1", 1, 1],
        ["e2", 1, 2],
        ["e3", 1, 3],
      ]);
      await db
        .insertInto("media_items")
        .values([titledItemFixture("p2"), titledItemFixture("p1")])
        .execute();
      await db
        .insertInto("content_facts")
        .values([
          { ...episodeFacts("p2", 8592, 1, 2), series_name: "Parks" },
          { ...episodeFacts("p1", 8592, 1, 1), series_name: "Parks" },
        ])
        .execute();
    },
  });
  const { server } = started;
  const created = await send(server, "POST", "/media-collections", {
    name: "The Office",
    criterion: OFFICE,
  });
  const office = created.body.id as string;
  await send(server, "PUT", `/media-collections/${office}/exclusions/e2`);
  return { ...started, office };
}

type Server = Awaited<ReturnType<typeof startServer>>["server"];

// Reads a member list response's IDs in position order.
function ids(members: unknown): string[] {
  return (members as { mediaItemId: string }[]).map((m) => m.mediaItemId);
}

// Reads a collection's member IDs in position order.
async function members(server: Server, id: string) {
  return ids(
    (await send(server, "GET", `/media-collections/${id}/items`)).body,
  );
}

describe("changing an automatic collection's criterion", () => {
  it("applies exactly the membership its preview showed, keeping exclusions through the change and back", async () => {
    const { server, office } = await startServer();

    const preview = await send(server, "POST", "/media-collections/previews", {
      criterion: PARKS,
      mediaCollectionId: office,
    });
    const changed = await send(
      server,
      "PATCH",
      `/media-collections/${office}`,
      {
        criterion: PARKS,
      },
    );

    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({
      name: "The Office",
      criterion: PARKS,
      criterionLabel: "Parks",
    });
    expect(await members(server, office)).toEqual(ids(preview.body));
    expect(await members(server, office)).toEqual(["p1", "p2"]);

    await send(server, "PATCH", `/media-collections/${office}`, {
      criterion: OFFICE,
    });

    expect(await members(server, office)).toEqual(["e1", "e3"]);
  });

  it("previews a collection's exclusions out, and a criterion alone with no collection", async () => {
    const { server, office } = await startServer();

    const withExclusions = await send(
      server,
      "POST",
      "/media-collections/previews",
      { criterion: OFFICE, mediaCollectionId: office },
    );
    const alone = await send(server, "POST", "/media-collections/previews", {
      criterion: OFFICE,
    });

    expect(ids(withExclusions.body)).toEqual(["e1", "e3"]);
    expect(ids(alone.body)).toEqual(["e1", "e2", "e3"]);
  });

  it("regenerates a channel drawing from the collection once", async () => {
    const { server, db, office } = await startServer();
    const channel = await send(server, "POST", "/channels", {
      number: "69",
      name: "Office TV",
    });
    await send(
      server,
      "POST",
      `/channels/${channel.body.id}/programming-blocks`,
      {
        source: {
          kind: "collection",
          mediaCollectionId: office,
          playbackMode: "chronological",
        },
      },
    );
    const revision = async () =>
      (
        await db
          .selectFrom("channel_schedule_states")
          .select("schedule_revision")
          .executeTakeFirstOrThrow()
      ).schedule_revision;
    const before = await revision();

    await send(server, "PATCH", `/media-collections/${office}`, {
      criterion: PARKS,
    });

    expect(await revision()).toBe(before + 1);
  });

  it("leaves the criterion alone on rename, and refuses a criterion for a manual collection", async () => {
    const { server, office } = await startServer();
    const manual = await send(server, "POST", "/media-collections", {
      name: "Scratch",
      mediaItemIds: ["e1"],
    });

    const renamed = await send(
      server,
      "PATCH",
      `/media-collections/${office}`,
      {
        name: "Dunder Mifflin",
      },
    );
    const refused = await send(
      server,
      "PATCH",
      `/media-collections/${manual.body.id as string}`,
      { criterion: OFFICE },
    );

    expect(renamed.body).toMatchObject({
      name: "Dunder Mifflin",
      criterion: OFFICE,
    });
    expect(await members(server, office)).toEqual(["e1", "e3"]);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("media_collection_manual");
  });
});
