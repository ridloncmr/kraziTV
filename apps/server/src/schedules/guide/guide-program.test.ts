import { describe, expect, it } from "vitest";

import { NO_CONTENT_METADATA } from "../../testing/metadata-match-fixtures.js";
import { guideProgram } from "./guide-program.js";

const BARE = {
  title: "s01e05-e06",
  subTitle: null,
  description: null,
  releaseDate: null,
  kind: null,
  genres: [],
  posterUrl: null,
  episode: null,
};

describe("guideProgram", () => {
  it("lists an episode under its series with its own title, numbers, and facts", () => {
    expect(
      guideProgram("s01e05-e06", {
        ...NO_CONTENT_METADATA,
        matchState: "matched",
        title: "The Train Job",
        seriesName: "Firefly",
        seasonNumber: 1,
        episodeNumber: 5,
        lastEpisodeNumber: 6,
        releaseDate: "2002-09-20",
        genres: ["Drama", "Western"],
        description: "Mal takes a job.",
        posterPath: "/firefly.jpg",
      }),
    ).toEqual({
      title: "Firefly",
      subTitle: "The Train Job",
      description: "Mal takes a job.",
      releaseDate: "2002-09-20",
      kind: "episode",
      genres: ["Drama", "Western"],
      posterUrl: "https://image.tmdb.org/t/p/w500/firefly.jpg",
      episode: { season: 1, episode: 5, lastEpisode: 6 },
    });
  });

  it("lists a movie under its TMDB title with its release, and no episode", () => {
    expect(
      guideProgram("alien", {
        ...NO_CONTENT_METADATA,
        matchState: "matched",
        title: "Alien",
        releaseDate: "1979",
        genres: ["Horror"],
      }),
    ).toEqual({
      ...BARE,
      title: "Alien",
      releaseDate: "1979",
      kind: "movie",
      genres: ["Horror"],
    });
  });

  it("leaves an episode's numbers out until both season and episode are known", () => {
    const program = guideProgram("s01e05-e06", {
      ...NO_CONTENT_METADATA,
      matchState: "matched",
      seriesName: "Firefly",
      seasonNumber: 1,
    });
    expect(program.title).toBe("Firefly");
    expect(program.kind).toBe("episode");
    expect(program.episode).toBeNull();
    expect(program.subTitle).toBeNull();
  });

  it("lists media without facts, and an extra, by the entry's own title alone", () => {
    expect(guideProgram("s01e05-e06", undefined)).toEqual(BARE);
    expect(guideProgram("s01e05-e06", NO_CONTENT_METADATA)).toEqual(BARE);
    expect(
      guideProgram("s01e05-e06", {
        ...NO_CONTENT_METADATA,
        matchState: "extra",
        title: "Making Of",
        description: "Bonus material.",
      }),
    ).toEqual(BARE);
  });
});
