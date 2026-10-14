import { describe, expect, it } from "vitest";

import { scheduleMedia } from "../testing/schedule-media.js";
import {
  METADATA_PLAYBACK_MODES,
  PLAYBACK_MODES,
  type ScheduleMedia,
} from "./contracts.js";
import {
  describeOrderedView,
  orderFingerprint,
  orderMembers,
} from "./ordered-view.js";

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

describe("orderMembers: release order", () => {
  // A member released on `releaseDate`, stored at the precision TMDB gave.
  function released(id: string, releaseDate: string | null): ScheduleMedia {
    return scheduleMedia(id, { releaseDate });
  }

  it("orders by year, then month, then day, not by saved order", () => {
    const members = [
      released("late-1999", "1999-12-31"),
      released("2001", "2001-01-01"),
      released("early-1999", "1999-01-02"),
      released("mid-1999", "1999-06-15"),
    ];

    expect(ids(orderMembers(members, "release"))).toEqual([
      "early-1999",
      "mid-1999",
      "late-1999",
      "2001",
    ]);
  });

  it("puts a year-only date after every date in that year with a month", () => {
    const members = [
      released("year-only", "1999"),
      released("december", "1999-12"),
      released("next-year", "2000-01-01"),
      released("march-3rd", "1999-03-03"),
    ];

    expect(ids(orderMembers(members, "release"))).toEqual([
      "march-3rd",
      "december",
      "year-only",
      "next-year",
    ]);
  });

  it("puts a month-only date after every date in that month with a day", () => {
    const members = [
      released("march", "1999-03"),
      released("april-1st", "1999-04-01"),
      released("march-31st", "1999-03-31"),
    ];

    expect(ids(orderMembers(members, "release"))).toEqual([
      "march-31st",
      "march",
      "april-1st",
    ]);
  });

  it("puts undated members last, in saved order", () => {
    const members = [
      released("undated-b", null),
      released("dated", "1980"),
      released("undated-a", null),
    ];

    expect(ids(orderMembers(members, "release"))).toEqual([
      "dated",
      "undated-b",
      "undated-a",
    ]);
  });

  it("keeps equal dates of equal precision in saved order", () => {
    const members = [
      released("z", "1999-05"),
      released("a", "1999-05"),
      released("m", "1999-05"),
    ];

    expect(ids(orderMembers(members, "release"))).toEqual(["z", "a", "m"]);
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

describe("describeOrderedView", () => {
  // Flags only, so each test reads as the preview's columns.
  function flags(view: ReturnType<typeof describeOrderedView>) {
    return view?.map((member) => [
      member.media.id,
      member.unresolved,
      member.startsSeriesGroup,
      member.duplicateEpisode,
    ]);
  }

  it("lists episode order with series group starts, duplicates, and unresolved members", () => {
    const members = [
      scheduleMedia("loose"),
      episode("parks-1", 8592, 1, 1, "Parks and Recreation"),
      episode("office-2", 2316, 1, 2),
      episode("office-1", 2316, 1, 1),
      episode("office-1-copy", 2316, 1, 1),
    ];

    expect(flags(describeOrderedView(members, "episode"))).toEqual([
      ["office-1", false, true, true],
      ["office-1-copy", false, false, true],
      ["office-2", false, false, false],
      ["parks-1", false, true, false],
      ["loose", true, false, false],
    ]);
  });

  it("lists the same order the scheduler plays", () => {
    const members = [
      episode("b", 2316, 2, 1),
      scheduleMedia("loose"),
      episode("a", 2316, 1, 1),
    ];

    expect(
      describeOrderedView(members, "episode")?.map((member) => member.media),
    ).toEqual(orderMembers(members, "episode"));
  });

  it("flags undated members as unresolved in release order, but not in collection order", () => {
    const members = [
      scheduleMedia("undated"),
      scheduleMedia("dated", { releaseDate: "1999" }),
    ];

    expect(flags(describeOrderedView(members, "release"))).toEqual([
      ["dated", false, false, false],
      ["undated", true, false, false],
    ]);
    expect(flags(describeOrderedView(members, "chronological"))).toEqual([
      ["undated", false, false, false],
      ["dated", false, false, false],
    ]);
  });

  it("flags duplicate episodes in every ordered mode", () => {
    const members = [episode("a", 2316, 1, 1), episode("b", 2316, 1, 1)];

    expect(flags(describeOrderedView(members, "chronological"))).toEqual([
      ["a", false, false, true],
      ["b", false, false, true],
    ]);
  });

  it("has no ordered view for random", () => {
    expect(
      describeOrderedView([episode("a", 2316, 1, 1)], "random"),
    ).toBeNull();
  });
});

describe("orderFingerprint", () => {
  const members = [
    episode("b", 2316, 1, 2),
    episode("a", 2316, 1, 1),
    episode("c", 2316, 1, 3),
  ];

  it("stays equal while the order does, even when other facts change", () => {
    const retitled = members.map((media) => ({
      ...media,
      title: `${media.title} (remastered)`,
    }));

    expect(orderFingerprint(retitled, "episode")).toBe(
      orderFingerprint(members, "episode"),
    );
  });

  it("changes when a correction reorders the members", () => {
    const corrected = [{ ...members[0], seasonNumber: 0 }, ...members.slice(1)];

    expect(orderFingerprint(corrected, "episode")).not.toBe(
      orderFingerprint(members, "episode"),
    );
  });

  it("is the same for saved orders that metadata puts in the same order", () => {
    expect(orderFingerprint([...members].reverse(), "episode")).toBe(
      orderFingerprint(members, "episode"),
    );
  });

  it.each(["chronological", "random"] as const)(
    "is null for %s, which never reads metadata",
    (playbackMode) => {
      expect(orderFingerprint(members, playbackMode)).toBeNull();
    },
  );
});

describe("METADATA_PLAYBACK_MODES", () => {
  it("lists exactly the modes whose order metadata can change", () => {
    const members = [episode("a", 2316, 1, 1)];

    expect(
      PLAYBACK_MODES.filter((mode) => orderFingerprint(members, mode) !== null),
    ).toEqual(METADATA_PLAYBACK_MODES);
  });
});
