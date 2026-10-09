import { afterEach, describe, expect, it } from "vitest";

import { send } from "../testing/api-requests.js";
import { PROBE_RESULT } from "../testing/discovery-fixtures.js";
import {
  ALIEN_PATH,
  correct,
  idOf,
  metadataOf,
  scanThroughRoutes as scan,
  scannedOnce,
  keep,
  EXTRA_PATH,
} from "../testing/enrichment-scan.js";
import { cleanUpTestEnvironment } from "../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

const MATCHED_MS = PROBE_RESULT.durationMs;

describe("files changed since they were matched", () => {
  it("flags a file whose duration moved more than 2 seconds, keeping its match and corrections", async () => {
    const { server, durations } = await scannedOnce([ALIEN_PATH]);
    const alien = await idOf(server, ALIEN_PATH);
    await correct(server, alien, { title: "Alien: Director's Cut" });

    durations.set(ALIEN_PATH, MATCHED_MS + 3_000);
    await scan(server);

    await expect(metadataOf(server, alien)).resolves.toMatchObject({
      matchState: "matched",
      fileChanged: true,
      title: "Alien: Director's Cut",
      releaseDate: "1979-05-25",
      correctedFields: ["title"],
    });
  });

  it("does not flag a duration within 2 seconds of the match-time one", async () => {
    const { server, durations } = await scannedOnce([ALIEN_PATH]);
    const alien = await idOf(server, ALIEN_PATH);

    durations.set(ALIEN_PATH, MATCHED_MS + 1_000);
    await scan(server);

    await expect(metadataOf(server, alien)).resolves.toMatchObject({
      matchState: "matched",
      fileChanged: false,
      title: "Alien",
    });
  });

  it("never flags a rejected item, an extra, or an item whose probe failed", async () => {
    const { server, durations, probeFailures } = await scannedOnce([
      ALIEN_PATH,
      "The Thing (1982)/movie.mkv",
      EXTRA_PATH,
    ]);
    const alien = await idOf(server, ALIEN_PATH);
    const thing = await idOf(server, "The Thing (1982)/movie.mkv");
    const extra = await idOf(server, EXTRA_PATH);
    await send(server, "POST", `/metadata/matches/${thing}/rejection`);

    probeFailures.push(ALIEN_PATH);
    for (const file of ["The Thing (1982)/movie.mkv", EXTRA_PATH]) {
      durations.set(file, MATCHED_MS + 3_000);
    }
    await scan(server);

    for (const [id, matchState] of [
      [alien, "matched"],
      [thing, "rejected"],
      [extra, "extra"],
    ]) {
      await expect(metadataOf(server, id)).resolves.toMatchObject({
        matchState,
        fileChanged: false,
      });
    }
  });

  it("keeps a flagged match, clearing the flag through later rescans", async () => {
    const { server, durations } = await scannedOnce([ALIEN_PATH]);
    const alien = await idOf(server, ALIEN_PATH);
    durations.set(ALIEN_PATH, MATCHED_MS + 3_000);
    await scan(server);

    await expect(keep(server, alien)).resolves.toMatchObject({
      status: 200,
      body: {
        id: alien,
        metadata: { matchState: "matched", fileChanged: false, title: "Alien" },
      },
    });

    await scan(server);
    await expect(metadataOf(server, alien)).resolves.toMatchObject({
      fileChanged: false,
    });
  });

  it("clears the flag when the owner saves a correction", async () => {
    const { server, durations } = await scannedOnce([ALIEN_PATH]);
    const alien = await idOf(server, ALIEN_PATH);
    durations.set(ALIEN_PATH, MATCHED_MS + 3_000);
    await scan(server);

    await expect(
      correct(server, alien, { title: "Aliens" }),
    ).resolves.toMatchObject({
      status: 200,
      body: { metadata: { title: "Aliens", fileChanged: false } },
    });
  });

  it("refuses to keep a match that is no longer matched, or an unknown item", async () => {
    const { server } = await scannedOnce([ALIEN_PATH]);
    const alien = await idOf(server, ALIEN_PATH);
    await send(server, "POST", `/metadata/matches/${alien}/rejection`);

    await expect(keep(server, alien)).resolves.toMatchObject({
      status: 409,
      body: { error: { code: "match_not_matched" } },
    });
    await expect(keep(server, "no-such-item")).resolves.toMatchObject({
      status: 404,
    });
  });
});
