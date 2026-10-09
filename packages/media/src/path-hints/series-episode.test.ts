import { describe, expect, it } from "vitest";

import { derivePathHints } from "./derive-path-hints.js";
import { seriesEpisode } from "./series-episode.js";
import type { PathPlatform } from "../paths/media-path.js";

// The shared series of a root-relative path.
function placeOf(relativePath: string, platform: PathPlatform = "win32") {
  return seriesEpisode(derivePathHints(relativePath.split("/")), platform);
}

describe("seriesEpisode", () => {
  it("shares one key across a series folder's season folders, ignoring case on Windows", () => {
    expect(placeOf("Doctor Who/Season 1/s01e01.mkv")?.key).toBe(
      placeOf("doctor who/Season 2/s02e03.mkv")?.key,
    );
    expect(placeOf("Doctor Who/Season 2/s02e03-e04.mkv")).toMatchObject({
      series: "Doctor Who",
      season: 2,
      episode: { first: 3, last: 4 },
    });
  });

  it("keeps distinct POSIX folders apart when only their casing differs", () => {
    expect(placeOf("Classic/Doctor Who/s01e01.mkv", "posix")?.key).not.toBe(
      placeOf("classic/Doctor Who/s01e02.mkv", "posix")?.key,
    );
    expect(placeOf("Doctor Who/Season 1/s01e01.mkv", "posix")?.key).toBe(
      placeOf("Doctor Who/Season 2/s02e01.mkv", "posix")?.key,
    );
  });

  it("tells apart series folders, and years in the folder name", () => {
    expect(placeOf("Doctor Who/s01e01.mkv")?.key).not.toBe(
      placeOf("Doctor Who (2005)/s01e01.mkv")?.key,
    );
    expect(placeOf("Firefly/s01e01.mkv")?.key).not.toBe(
      placeOf("Doctor Who/s01e01.mkv")?.key,
    );
  });

  it("places neither a movie nor a disc track", () => {
    expect(placeOf("Alien (1979)/movie.mkv")).toBeUndefined();
    expect(placeOf("Some Show/t_01.mkv")).toBeUndefined();
  });
});
