import { describe, expect, it } from "vitest";

import { derivePathHints } from "./derive-path-hints.js";
import { fallbackTitle } from "./fallback-title.js";

// Builds the title for a root-relative path whose filename title is its stem.
function titleFor(relativePath: string): string {
  const segments = relativePath.split("/");
  const stem = (segments.at(-1) ?? "").replace(/\.[^.]+$/, "");
  return fallbackTitle(derivePathHints(segments), stem);
}

describe("fallbackTitle", () => {
  it.each([
    ["Firefly/Season 1/s01e05.mp4", "Firefly – S01E05"],
    ["Show/s01e05-e06.mkv", "Show – S01E05–E06"],
    ["Firefly/Specials/s00e01.mkv", "Firefly – S00E01"],
    ["Show/Season 12/s12e104.mkv", "Show – S12E104"],
    ["Alien (1979)/movie.mkv", "Alien (1979)"],
    ["The Thing/movie.mkv", "The Thing"],
    ["Movies/Heat (1995) [1080p].mkv", "Heat (1995)"],
    ["Some Show/t_01.mkv", "Some Show – Track 1"],
    ["Some Show/Disc 2/title_t03.mkv", "Some Show – Disc 2 Track 3"],
  ])("titles %s as %s", (path, title) => {
    expect(titleFor(path)).toBe(title);
  });

  it.each([
    ["an episode with no series", "TV/Downloads/s01e05.mp4", "s01e05"],
    ["an extra", "Firefly/Featurettes/making-of.mkv", "making-of"],
    [
      "a season file without an episode",
      "Firefly/Season 1/Serenity.mkv",
      "Serenity",
    ],
    ["a generic name with no title folder", "Movies/movie.mkv", "movie"],
  ])("keeps the filename title for %s", (_label, path, title) => {
    expect(titleFor(path)).toBe(title);
  });
});
