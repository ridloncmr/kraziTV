import { describe, expect, it } from "vitest";
import { trackOf } from "../testing/disc-track-fixtures.js";

describe("discTrack", () => {
  it("groups a season's discs together, ignoring case on Windows", () => {
    expect(trackOf("Some Show/Season 1/Disc 1/t_00.mkv")?.key).toBe(
      trackOf("some show/Season 1/Disc 2/t_03.mkv")?.key,
    );
    expect(trackOf("Some Show/Season 1/Disc 2/t_03.mkv")).toEqual({
      key: expect.any(String),
      series: "Some Show",
      season: 1,
      disc: 2,
      track: 3,
    });
  });

  it("keeps season folders, series folders, and POSIX casings apart", () => {
    expect(trackOf("Some Show/Season 1/Disc 1/t_00.mkv")?.key).not.toBe(
      trackOf("Some Show/Season 2/Disc 1/t_00.mkv")?.key,
    );
    expect(trackOf("Some Show/t_00.mkv")?.key).not.toBe(
      trackOf("Other Show/t_00.mkv")?.key,
    );
    expect(trackOf("Some Show/t_00.mkv", "posix")?.key).not.toBe(
      trackOf("some show/t_01.mkv", "posix")?.key,
    );
  });

  it("places neither an episode, a movie, nor a track under an extras folder", () => {
    expect(trackOf("Some Show/s01e01.mkv")).toBeUndefined();
    expect(trackOf("Alien (1979)/movie.mkv")).toBeUndefined();
    expect(trackOf("Some Show/Extras/t_01.mkv")).toBeUndefined();
  });
});
