import { afterEach, describe, expect, it } from "vitest";
import { countQueries } from "../../testing/query-counter.js";
import { cleanUpTestEnvironment } from "../../testing/test-environment.js";
import { catalog, DISC_1, DISC_2 } from "../../testing/track-catalog.js";
import { readTrackFolder } from "./track-folder.js";
afterEach(cleanUpTestEnvironment);

describe("readTrackFolder", () => {
  it("reads only the rows under the series folder, never a similarly named sibling", async () => {
    const db = await catalog([
      DISC_1,
      DISC_2,
      "Some Show Extended/Season 1/Disc 1/t_00.mkv",
      "Other Show/Season 1/Disc 1/t_00.mkv",
      "Alien (1979)/movie.mkv",
      "Zulu/movie.mkv",
    ]);
    const counted = countQueries(db);

    const folder = await readTrackFolder(counted.db, DISC_1);

    expect(folder).toMatchObject({
      series: "Some Show",
      season: 1,
      tracks: [{ mediaItemId: DISC_1 }, { mediaItemId: DISC_2 }],
    });
    // The anchor row, then only the series folder's two files.
    expect(counted.rows()).toBe(3);
  });

  it("maps a rip at the root's top level apart from tracks in named folders", async () => {
    const db = await catalog(["t_00.mkv", "t_01.mkv", "Show/t_00.mkv"]);

    await expect(readTrackFolder(db, "t_00.mkv")).resolves.toMatchObject({
      tracks: [{ mediaItemId: "t_00.mkv" }, { mediaItemId: "t_01.mkv" }],
    });
  });
});
