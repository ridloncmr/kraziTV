import { afterEach, describe, expect, it } from "vitest";

import { send } from "../../testing/api-requests.js";
import {
  idOf,
  scanThroughRoutes as scan,
  scannedWithFirefly as scanned,
  correct,
  metadataOf,
} from "../../testing/enrichment-scan.js";

import { cleanUpTestEnvironment } from "../../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

const THE_THING_1982 = 1091;

describe("correction routes", () => {
  it("puts a corrected title ahead of TMDB's, and clearing it restores TMDB's", async () => {
    const { server } = await scanned(["Alien (1979)/movie.mkv"]);
    const alien = await idOf(server, "Alien (1979)/movie.mkv");

    await expect(
      correct(server, alien, { title: "Alien: Director's Cut" }),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        id: alien,
        metadata: {
          matchState: "matched",
          title: "Alien: Director's Cut",
          releaseDate: "1979-05-25",
          correctedFields: ["title"],
        },
      },
    });

    await expect(
      correct(server, alien, { title: null }),
    ).resolves.toMatchObject({
      status: 200,
      body: { metadata: { title: "Alien", correctedFields: [] } },
    });
  });

  it("keeps a corrected item out of rescan lookups, and its correction through them", async () => {
    const { server, tmdb } = await scanned(["Nothing/movie.mkv"]);
    const nothing = await idOf(server, "Nothing/movie.mkv");
    await correct(server, nothing, { title: "Home Movies 1998" });
    const callsBefore = tmdb.paths().length;

    await scan(server);

    expect(tmdb.paths()).toHaveLength(callsBefore);
    await expect(metadataOf(server, nothing)).resolves.toMatchObject({
      matchState: "unmatched",
      title: "Home Movies 1998",
    });
  });

  it("keeps a correction when a choice replaces the item's match and facts", async () => {
    const { server } = await scanned(["The Thing/movie.mkv"]);
    const thing = await idOf(server, "The Thing/movie.mkv");
    await correct(server, thing, { title: "The Thing (Carpenter)" });

    await send(server, "POST", `/metadata/matches/${thing}/choice`, {
      tmdbId: THE_THING_1982,
    });

    await expect(metadataOf(server, thing)).resolves.toMatchObject({
      matchState: "matched",
      title: "The Thing (Carpenter)",
      releaseDate: "1982-06-25",
    });
  });

  it("corrects a two-part episode to a single episode, leaving uncorrected fields to TMDB", async () => {
    const { server } = await scanned(["Firefly/Season 1/s01e05-e06.mkv"]);
    const episode = await idOf(server, "Firefly/Season 1/s01e05-e06.mkv");

    await expect(
      correct(server, episode, { episodeNumber: 7 }),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        metadata: {
          seriesName: "Firefly",
          seasonNumber: 1,
          episodeNumber: 7,
          lastEpisodeNumber: 7,
          correctedFields: ["episodeNumber"],
        },
      },
    });
  });

  it("corrects series, season, and episode with no TMDB key set", async () => {
    const { server } = await scanned(["Some Show/t_01.mkv"], { key: false });
    const track = await idOf(server, "Some Show/t_01.mkv");

    await expect(
      correct(server, track, {
        seriesName: "Some Show",
        seasonNumber: 2,
        episodeNumber: 3,
      }),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        metadata: {
          matchState: "not_looked_up",
          seriesName: "Some Show",
          seasonNumber: 2,
          episodeNumber: 3,
          lastEpisodeNumber: 3,
          correctedFields: ["seriesName", "seasonNumber", "episodeNumber"],
        },
      },
    });
  });

  it("round-trips tags trimmed and once each, and deletes a row left empty", async () => {
    const { server, db } = await scanned(["Alien (1979)/movie.mkv"]);
    const alien = await idOf(server, "Alien (1979)/movie.mkv");

    await correct(server, alien, { tags: [" space ", "horror", "space"] });
    await expect(metadataOf(server, alien)).resolves.toMatchObject({
      tags: ["space", "horror"],
      correctedFields: [],
    });

    await correct(server, alien, { tags: [] });
    await expect(metadataOf(server, alien)).resolves.toMatchObject({
      tags: [],
    });
    await expect(
      db.selectFrom("metadata_corrections").selectAll().execute(),
    ).resolves.toEqual([]);
  });

  it("lands concurrent changes to different fields of one item", async () => {
    const { server } = await scanned(["Alien (1979)/movie.mkv"]);
    const alien = await idOf(server, "Alien (1979)/movie.mkv");

    await Promise.all([
      correct(server, alien, { title: "Alien (1979)" }),
      correct(server, alien, { tags: ["space"] }),
      correct(server, alien, { seasonNumber: 0 }),
    ]);

    await expect(metadataOf(server, alien)).resolves.toMatchObject({
      title: "Alien (1979)",
      seasonNumber: 0,
      tags: ["space"],
    });
  });

  it("refuses an unknown or removed item", async () => {
    const { server } = await scanned(["Alien (1979)/movie.mkv"]);
    const alien = await idOf(server, "Alien (1979)/movie.mkv");
    await expect(
      send(server, "POST", "/catalog-removals", {
        target: { mediaItemIds: [alien] },
      }),
    ).resolves.toMatchObject({ status: 200 });

    for (const id of ["no-such-item", alien]) {
      await expect(
        correct(server, id, { title: "Anything" }),
      ).resolves.toMatchObject({
        status: 404,
        body: { error: { code: "media_item_not_found" } },
      });
    }
  });

  it.each([
    ["no field", {}],
    ["a blank title", { title: "  " }],
    ["a negative season", { seasonNumber: -1 }],
    ["a fractional episode", { episodeNumber: 1.5 }],
    ["a blank tag", { tags: ["space", " "] }],
    ["an uncorrectable field", { genres: ["Horror"] }],
  ])("refuses %s", async (_, change) => {
    const { server } = await scanned(["Alien (1979)/movie.mkv"]);
    const alien = await idOf(server, "Alien (1979)/movie.mkv");

    await expect(correct(server, alien, change)).resolves.toMatchObject({
      status: 400,
      body: { error: { code: "invalid_request" } },
    });
    await expect(metadataOf(server, alien)).resolves.toMatchObject({
      correctedFields: [],
      tags: [],
    });
  });
});
