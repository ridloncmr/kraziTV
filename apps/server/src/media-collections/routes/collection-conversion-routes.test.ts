import { afterEach, describe, expect, it } from "vitest";

import { send } from "../../testing/api-requests.js";
import { seedEpisodes } from "../../testing/collection-fixtures.js";
import {
  cleanUpTestEnvironment,
  startTestServer,
} from "../../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

/**
 * Boots a server cataloging three Office episodes with an automatic Office
 * collection that excludes the second.
 */
async function startServer() {
  const started = await startTestServer({
    seed: (db) =>
      seedEpisodes(db, [
        ["e1", 1, 1],
        ["e2", 1, 2],
        ["e3", 1, 3],
      ]),
  });
  const { server } = started;
  const created = await send(server, "POST", "/media-collections", {
    name: "The Office",
    criterion: { kind: "series", tmdbId: 2316 },
  });
  const office = created.body.id as string;
  await send(server, "PUT", `/media-collections/${office}/exclusions/e2`);
  return { ...started, office };
}

type Server = Awaited<ReturnType<typeof startServer>>["server"];

// Reads a collection's member IDs in position order.
async function members(server: Server, id: string) {
  const { body } = await send(server, "GET", `/media-collections/${id}/items`);
  return (body as { mediaItemId: string }[]).map((m) => m.mediaItemId);
}

describe("POST /media-collections/:id/conversion", () => {
  it("makes the collection manual with the same members and order, and clears its criterion, exclusions, and diagnostics", async () => {
    const { server, office } = await startServer();

    const converted = await send(
      server,
      "POST",
      `/media-collections/${office}/conversion`,
    );

    expect(converted.status).toBe(200);
    expect(converted.body).toMatchObject({
      maintenanceMode: "manual",
      criterion: null,
      criterionLabel: null,
      maintainedAt: null,
      maintenanceError: null,
      maintenanceIncomplete: null,
    });
    expect(await members(server, office)).toEqual(["e1", "e3"]);
    await expect(
      send(server, "GET", `/media-collections/${office}/exclusions`),
    ).resolves.toMatchObject({ body: [] });
  });

  it("leaves a converted collection alone when a later episode matches, and lets the owner edit it", async () => {
    const { server, db, office, dependencies } = await startServer();
    await send(server, "POST", `/media-collections/${office}/conversion`);

    await seedEpisodes(db, [["e4", 1, 4]], { withRoot: false });
    await dependencies.collectionMaintenance.request();

    expect(await members(server, office)).toEqual(["e1", "e3"]);
    const edited = await send(
      server,
      "PUT",
      `/media-collections/${office}/items`,
      { mediaItemIds: ["e3", "e1", "e4"] },
    );
    expect(edited.status).toBe(200);
  });

  it("answers the collection unchanged when it is already manual, and 404 for an unknown one", async () => {
    const { server } = await startServer();
    const manual = await send(server, "POST", "/media-collections", {
      name: "Scratch",
      mediaItemIds: ["e2"],
    });
    const scratch = manual.body.id as string;

    const again = await send(
      server,
      "POST",
      `/media-collections/${scratch}/conversion`,
    );
    const unknown = await send(
      server,
      "POST",
      "/media-collections/ghost/conversion",
    );

    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ maintenanceMode: "manual" });
    expect(await members(server, scratch)).toEqual(["e2"]);
    expect(unknown.status).toBe(404);
  });
});
