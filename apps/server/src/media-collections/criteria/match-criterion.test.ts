import { describe, expect, it } from "vitest";

import { matchableEpisode } from "../../testing/collection-fixtures.js";
import { matchCriterion } from "./match-criterion.js";

const OFFICE = { kind: "series", tmdbId: 2316 } as const;

// Matches the Office criterion and reads back the ordered IDs.
function officeOrder(...items: Parameters<typeof matchCriterion>[1]) {
  return matchCriterion(OFFICE, items).map((item) => item.id);
}

describe("matchCriterion: series", () => {
  it("orders episodes by season, then episode, then path, not by ID or title", () => {
    expect(
      officeOrder(
        matchableEpisode("a", 2316, { season: 2, episode: 1 }),
        matchableEpisode("b", 2316, { season: 1, episode: 10 }),
        matchableEpisode("c", 2316, { season: 1, episode: 2 }),
        matchableEpisode("d", 2316, {
          season: 1,
          episode: 2,
          path: "/tv/office/a-duplicate.mkv",
        }),
      ),
    ).toEqual(["d", "c", "b", "a"]);
  });

  it("puts unknown season and episode numbers last", () => {
    expect(
      officeOrder(
        matchableEpisode("no-season", 2316, { season: null, episode: 1 }),
        matchableEpisode("no-episode", 2316, { season: 1, episode: null }),
        matchableEpisode("known", 2316, { season: 1, episode: 9 }),
      ),
    ).toEqual(["known", "no-episode", "no-season"]);
  });

  it("matches only the criterion's series identity, whatever the series is named", () => {
    expect(
      officeOrder(
        matchableEpisode("uk", 2996, { seriesName: "The Office" }),
        matchableEpisode("us", 2316, { seriesName: "The Office (US)" }),
        matchableEpisode("unknown", null),
      ),
    ).toEqual(["us"]);
  });

  it("keeps a missing file, since missing status is temporary", () => {
    expect(
      officeOrder(matchableEpisode("gone", 2316, { status: "missing" })),
    ).toEqual(["gone"]);
  });
});
