import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { send, waitForMembers } from "../testing/api-requests.js";
import {
  correct,
  idOf,
  scanThroughRoutes as scan,
  startEnrichmentServer,
} from "../testing/enrichment-scan.js";
import { SCAN_FIREFLY } from "../testing/scan-metadata.js";
import { cleanUpTestEnvironment } from "../testing/test-environment.js";
import {
  ACCEPTED,
  apply,
  SOME_SHOW,
  TRACKS,
  scanned as scannedDiscRip,
} from "../testing/track-mapping-fixtures.js";

afterEach(cleanUpTestEnvironment);

const E1 = "Firefly/Season 1/s01e01.mkv";
const E2 = "Firefly/Season 1/s01e02.mkv";
const E3 = "Firefly/Season 1/s01e03.mkv";

// Creates a collection and returns its ID.
async function create(server: FastifyInstance, body: object): Promise<string> {
  const { status, body: created } = await send(
    server,
    "POST",
    "/media-collections",
    body,
  );
  expect(status).toBe(201);
  return (created as { id: string }).id;
}

/**
 * Scans two Firefly episodes, then creates an automatic Firefly collection
 * and a manual snapshot of the same episodes. Writers in each test ask the
 * server's real maintenance for passes; tests only wait for the result.
 */
async function fireflyCollections() {
  const files = [E2, E1];
  const context = await startEnrichmentServer({ files });
  context.tmdb.series.push(SCAN_FIREFLY);
  await scan(context.server);
  const { server } = context;
  const e1 = await idOf(server, E1);
  const e2 = await idOf(server, E2);
  const automatic = await create(server, {
    name: "Firefly",
    criterion: { kind: "series", tmdbId: SCAN_FIREFLY.id },
  });
  const snapshot = await create(server, {
    name: "Firefly snapshot",
    mediaItemIds: [e1, e2],
  });
  return { ...context, files, e1, e2, automatic, snapshot };
}

describe("automatic collection maintenance", () => {
  it("adds a newly scanned episode to the automatic collection but not to a manual snapshot", async () => {
    const { server, files, e1, e2, automatic, snapshot } =
      await fireflyCollections();

    files.push(E3);
    await scan(server);
    const e3 = await idOf(server, E3);

    await waitForMembers(server, automatic, [e1, e2, e3]);
    await waitForMembers(server, snapshot, [e1, e2], 0);
  });

  it("reorders after a season correction and drops a rejected episode", async () => {
    const { server, e1, e2, automatic, snapshot } = await fireflyCollections();

    expect((await correct(server, e1, { seasonNumber: 2 })).status).toBe(200);
    await waitForMembers(server, automatic, [e2, e1]);

    expect(
      (await send(server, "POST", `/metadata/matches/${e2}/rejection`)).status,
    ).toBe(200);
    await waitForMembers(server, automatic, [e1]);
    await waitForMembers(server, snapshot, [e1, e2], 0);
  });

  it("adds disc tracks once they are mapped to the series' episodes", async () => {
    const { server } = await scannedDiscRip();
    const someShow = await create(server, {
      name: "Some Show",
      criterion: { kind: "series", tmdbId: SOME_SHOW.id },
    });
    await waitForMembers(server, someShow, [], 0);

    expect((await apply(server, ACCEPTED)).status).toBe(200);

    await waitForMembers(server, someShow, [
      await idOf(server, TRACKS.first),
      await idOf(server, TRACKS.second),
      await idOf(server, TRACKS.third),
    ]);
  });

  it("adds a newly matched franchise movie at its release position", async () => {
    const indy = { id: 84, name: "Indiana Jones Collection" };
    const files = [
      "Indiana Jones and the Last Crusade (1989)/movie.mkv",
      "Raiders of the Lost Ark (1981)/movie.mkv",
    ];
    const { server, tmdb } = await startEnrichmentServer({ files });
    tmdb.movies.push(
      {
        id: 85,
        title: "Raiders of the Lost Ark",
        releaseDate: "1981-06-12",
        franchise: indy,
      },
      {
        id: 87,
        title: "Indiana Jones and the Temple of Doom",
        releaseDate: "1984-05-23",
        franchise: indy,
      },
      {
        id: 89,
        title: "Indiana Jones and the Last Crusade",
        releaseDate: "1989-05-24",
        franchise: indy,
      },
    );
    await scan(server);
    const franchise = await create(server, {
      name: "Indiana Jones",
      criterion: { kind: "franchise", tmdbId: indy.id },
    });
    const raiders = await idOf(server, files[1]);
    const crusade = await idOf(server, files[0]);
    await waitForMembers(server, franchise, [raiders, crusade], 0);

    files.push("Indiana Jones and the Temple of Doom (1984)/movie.mkv");
    await scan(server);

    await waitForMembers(server, franchise, [
      raiders,
      await idOf(server, files[2]),
      crusade,
    ]);
  });
});
