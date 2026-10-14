import { describe, expect, it } from "vitest";

import { scheduleMedia } from "../testing/schedule-media.js";
import type { ScheduleMedia } from "./contracts.js";
import { orderMembers } from "./ordered-view.js";

// An episode of a TMDB series; IDs never follow the episode order.
function episode(
  id: string,
  seriesTmdbId: number | null,
  seasonNumber: number | null,
  episodeNumber: number | null,
  seriesName: string | null = "The Office",
): ScheduleMedia {
  return scheduleMedia(id, {
    seriesTmdbId,
    seriesName,
    seasonNumber,
    episodeNumber,
  });
}

function ids(members: readonly ScheduleMedia[]): string[] {
  return members.map((media) => media.id);
}

describe("orderMembers: episode order", () => {
  it("orders one series by season, then episode, not by saved order", () => {
    const members = [
      episode("m", 2316, 2, 1),
      episode("z", 2316, 1, 3),
      episode("a", 2316, 1, 1),
      episode("k", 2316, 1, 2),
    ];

    expect(ids(orderMembers(members, "episode"))).toEqual(["a", "k", "z", "m"]);
  });

  it("puts season zero before season one", () => {
    const members = [
      episode("pilot", 2316, 1, 1),
      episode("special", 2316, 0, 5),
    ];

    expect(ids(orderMembers(members, "episode"))).toEqual(["special", "pilot"]);
  });

  it("groups mixed series by their key instead of interleaving them", () => {
    const members = [
      episode("office-1", 2316, 1, 1, "The Office"),
      episode("parks-1", 8592, 1, 1, "Parks and Recreation"),
      episode("office-2", 2316, 1, 2, "The Office"),
      episode("parks-2", 8592, 1, 2, "Parks and Recreation"),
    ];

    // Keys compare as text, so "tmdb:2316" sorts before "tmdb:8592".
    expect(ids(orderMembers(members, "episode"))).toEqual([
      "office-1",
      "office-2",
      "parks-1",
      "parks-2",
    ]);
  });

  it("groups a series without a TMDB ID by its name, ignoring case and spacing", () => {
    const members = [
      episode("second", null, 1, 2, "  the   OFFICE (us)"),
      episode("tmdb", 2316, 1, 1, "The Office (US)"),
      episode("first", null, 1, 1, "The Office (US)"),
    ];

    // A corrected name never joins the TMDB series of the same name.
    expect(ids(orderMembers(members, "episode"))).toEqual([
      "first",
      "second",
      "tmdb",
    ]);
  });

  it("sorts a multi-episode file at its first episode", () => {
    // "double" holds episodes 2-3; it carries only its first episode.
    const members = [
      episode("four", 2316, 1, 4),
      episode("double", 2316, 1, 2),
      episode("one", 2316, 1, 1),
    ];

    expect(ids(orderMembers(members, "episode"))).toEqual([
      "one",
      "double",
      "four",
    ]);
  });

  it("puts members without a series, season, or episode last, in saved order", () => {
    const members = [
      scheduleMedia("extra"),
      episode("no-episode", 2316, 1, null),
      episode("resolved", 2316, 1, 1),
      episode("no-season", 2316, null, 1),
      episode("no-series", null, 1, 1, null),
    ];

    expect(ids(orderMembers(members, "episode"))).toEqual([
      "resolved",
      "extra",
      "no-episode",
      "no-season",
      "no-series",
    ]);
  });

  it("keeps duplicate episodes in saved order", () => {
    const members = [
      episode("z-copy", 2316, 1, 1),
      episode("b-copy", 2316, 1, 1),
    ];

    expect(ids(orderMembers(members, "episode"))).toEqual(["z-copy", "b-copy"]);
  });
});

describe("orderMembers: modes that keep saved order", () => {
  it.each(["chronological", "random"] as const)(
    "returns %s members in saved order",
    (playbackMode) => {
      const members = [episode("b", 2316, 1, 2), episode("a", 2316, 1, 1)];

      expect(ids(orderMembers(members, playbackMode))).toEqual(["b", "a"]);
    },
  );
});
