import { describe, expect, it } from "vitest";

import {
  matchableEpisode,
  matchableMovie,
} from "../../testing/collection-fixtures.js";
import { matchMembership } from "./match-criterion.js";

const OFFICE = { kind: "series", tmdbId: 2316 } as const;

// Matches the Office criterion and reads back the ordered IDs.
function officeOrder(...items: Parameters<typeof matchMembership>[1]) {
  return matchMembership(OFFICE, items, [], []).members.map((item) => item.id);
}

describe("matchMembership: series order", () => {
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

const INDIANA_JONES = { kind: "franchise", tmdbId: 84 } as const;

// Matches the Indiana Jones criterion and reads back the ordered IDs.
function franchiseOrder(...items: Parameters<typeof matchMembership>[1]) {
  return matchMembership(INDIANA_JONES, items, [], []).members.map(
    (item) => item.id,
  );
}

describe("matchMembership: franchise order", () => {
  it("orders movies by release, not by ID, title, or path", () => {
    expect(
      franchiseOrder(
        matchableMovie("a", 84, {
          releaseDate: "1989-05-24",
          title: "Crusade",
        }),
        matchableMovie("b", 84, {
          releaseDate: "1981-06-12",
          title: "Raiders",
        }),
        matchableMovie("c", 84, { releaseDate: "1984-05-23", title: "Doom" }),
      ),
    ).toEqual(["b", "c", "a"]);
  });

  it("puts a year-only date before a full date that year, and unknown dates last", () => {
    expect(
      franchiseOrder(
        matchableMovie("unknown", 84, { releaseDate: null }),
        matchableMovie("full", 84, { releaseDate: "1981-06-12" }),
        matchableMovie("month", 84, { releaseDate: "1981-03" }),
        matchableMovie("year", 84, { releaseDate: "1981" }),
      ),
    ).toEqual(["year", "month", "full", "unknown"]);
  });

  it("breaks a release tie by title, then path", () => {
    expect(
      franchiseOrder(
        matchableMovie("z", 84, { releaseDate: "2008", title: "beta" }),
        matchableMovie("y", 84, {
          releaseDate: "2008",
          title: "Alpha",
          path: "/movies/2.mkv",
        }),
        matchableMovie("x", 84, {
          releaseDate: "2008",
          title: "Alpha",
          path: "/movies/1.mkv",
        }),
      ),
    ).toEqual(["x", "y", "z"]);
  });

  it("stays a separate criterion from a series sharing the TMDB ID number", () => {
    expect(
      franchiseOrder(
        matchableEpisode("episode", 84),
        matchableMovie("movie", 84),
        matchableMovie("other", 85),
      ),
    ).toEqual(["movie"]);
  });
});

describe("matchMembership", () => {
  const ids = (result: ReturnType<typeof matchMembership>) =>
    result.members.map((item) => item.id);

  it("keeps a member whose TMDB data expired, in order, and reports maintenance incomplete", () => {
    const result = matchMembership(
      OFFICE,
      [
        matchableEpisode("e2", 2316, { episode: 2 }),
        matchableEpisode("e1", 2316, { episode: 1, expired: true }),
      ],
      ["e1", "e2"],
      [],
    );

    expect(ids(result)).toEqual(["e1", "e2"]);
    expect(result.incomplete).toBe(true);
  });

  it("does not add an item whose TMDB data expired, and reports maintenance incomplete", () => {
    const result = matchMembership(
      OFFICE,
      [
        matchableEpisode("e2", 2316, { episode: 2 }),
        matchableEpisode("e1", 2316, { episode: 1, expired: true }),
      ],
      ["e2"],
      [],
    );

    expect(ids(result)).toEqual(["e2"]);
    expect(result.incomplete).toBe(true);
  });

  it("is complete when no expired item belongs or would match", () => {
    const result = matchMembership(
      OFFICE,
      [
        matchableEpisode("e1", 2316),
        matchableEpisode("parks", 8592, { expired: true }),
      ],
      [],
      [],
    );

    expect(ids(result)).toEqual(["e1"]);
    expect(result.incomplete).toBe(false);
  });

  it("leaves out an excluded item even while it matches, and an excluded expired item never makes it incomplete", () => {
    const result = matchMembership(
      OFFICE,
      [
        matchableEpisode("e1", 2316, { episode: 1 }),
        matchableEpisode("e2", 2316, { episode: 2 }),
        matchableEpisode("e3", 2316, { episode: 3, expired: true }),
      ],
      ["e1", "e2", "e3"],
      ["e2", "e3"],
    );

    expect(ids(result)).toEqual(["e1"]);
    expect(result.incomplete).toBe(false);
  });
});

describe("matchMembership: tag", () => {
  const CHRISTMAS = { kind: "tag", tagId: "tag-christmas" } as const;

  it("matches tagged movies and episodes, not untagged siblings, in release order", () => {
    const result = matchMembership(
      CHRISTMAS,
      [
        matchableMovie("elf", null, {
          releaseDate: "2003-10-09",
          tagIds: ["tag-christmas"],
        }),
        matchableMovie("alone", null, {
          releaseDate: "1990-11-10",
          tagIds: ["tag-other", "tag-christmas"],
        }),
        matchableMovie("untagged", null, { releaseDate: "1980" }),
      ],
      [],
      [],
    );

    expect(result.members.map((item) => item.id)).toEqual(["alone", "elf"]);
  });

  it("needs no provider evidence, so an item whose TMDB data expired still matches and nothing is incomplete", () => {
    const expired = {
      ...matchableMovie("elf", null, { tagIds: ["tag-christmas"] }),
    };
    expired.metadata = { ...expired.metadata, tmdbDataExpired: true };

    const result = matchMembership(CHRISTMAS, [expired], [], []);

    expect(result.members.map((item) => item.id)).toEqual(["elf"]);
    expect(result.incomplete).toBe(false);
  });
});
