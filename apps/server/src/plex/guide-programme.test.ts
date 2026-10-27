import { describe, expect, it } from "vitest";

import { NO_CONTENT_METADATA } from "../testing/metadata-match-fixtures.js";
import { guideProgramme } from "./guide-programme.js";

const entry = { title: "s01e05-e06", startsAt: 1_000, endsAt: 2_000 };

describe("guideProgramme", () => {
  it("lists an episode under its series with its own title, numbers, and facts", () => {
    expect(
      guideProgramme(entry, {
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
      startsAt: 1_000,
      endsAt: 2_000,
      title: "Firefly",
      subTitle: "The Train Job",
      description: "Mal takes a job.",
      date: "20020920",
      categories: ["Series", "Drama", "Western"],
      iconUrl: "https://image.tmdb.org/t/p/w500/firefly.jpg",
      episode: { season: 1, episode: 5, lastEpisode: 6 },
    });
  });

  it("lists a movie under its TMDB title with its year, and no episode", () => {
    expect(
      guideProgramme(entry, {
        ...NO_CONTENT_METADATA,
        matchState: "matched",
        title: "Alien",
        releaseDate: "1979",
        genres: ["Horror"],
      }),
    ).toEqual({
      startsAt: 1_000,
      endsAt: 2_000,
      title: "Alien",
      description: null,
      date: "1979",
      categories: ["Movie", "Horror"],
      iconUrl: null,
    });
  });

  it("leaves an episode's numbers out until both season and episode are known", () => {
    const programme = guideProgramme(entry, {
      ...NO_CONTENT_METADATA,
      matchState: "matched",
      seriesName: "Firefly",
      seasonNumber: 1,
    });
    expect(programme.title).toBe("Firefly");
    expect(programme.episode).toBeNull();
    expect(programme.subTitle).toBeNull();
  });

  it("lists media without facts, and an extra, by the entry's own title alone", () => {
    const bare = { startsAt: 1_000, endsAt: 2_000, title: "s01e05-e06" };
    expect(guideProgramme(entry, undefined)).toEqual(bare);
    expect(guideProgramme(entry, NO_CONTENT_METADATA)).toEqual(bare);
    expect(
      guideProgramme(entry, {
        ...NO_CONTENT_METADATA,
        matchState: "extra",
        title: "Making Of",
        description: "Bonus material.",
      }),
    ).toEqual(bare);
  });
});
