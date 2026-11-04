import { describe, expect, it } from "vitest";
import type { StretchSuggestion } from "../../../http/contracts/programming.js";
import type { FoundMember } from "../../../media-search/collection-or-item-search.js";
import { UNCHOSEN_STRETCH } from "../../stretch/stretch-fields.js";
import { suggestionPath } from "../show-draft.js";
import {
  type PickedShowInputs,
  pickedShows,
  suggestionPaths,
  toAssignments,
  unfinishedWords,
} from "./picked-shows.js";

const seinfeld: FoundMember = {
  member: { kind: "collection", mediaCollectionId: "c-seinfeld" },
  name: "Seinfeld",
  detail: "Collection",
};
const cheers: FoundMember = {
  member: { kind: "collection", mediaCollectionId: "c-cheers" },
  name: "Cheers",
  detail: "Collection",
};
const pilot: FoundMember = {
  member: { kind: "media_item", mediaItemId: "i-pilot" },
  name: "pilot.mkv",
  detail: "Media item",
};

const halfHour: StretchSuggestion = {
  ordinaryStretch: { kind: "airtime", minutes: 30 },
  contentKind: "episodes",
};

// The path a lone pick's suggestion is read from.
const pathOf = (pick: FoundMember) => suggestionPath([pick.member]);

// Inputs with every suggestion read as `read` gives it, and nothing chosen.
function inputs(
  overrides: Partial<PickedShowInputs> = {},
  read: (path: string) => StretchSuggestion | undefined = () => halfHour,
): PickedShowInputs {
  return {
    grouping: "separate",
    name: "",
    chosen: new Map(),
    suggestions: { get: read, failed: () => false },
    ...overrides,
  };
}

describe("picked shows", () => {
  it("reads a suggestion only for shows that play a collection", () => {
    expect(suggestionPaths([seinfeld, pilot], "separate")).toEqual([
      pathOf(seinfeld),
    ]);
    expect(suggestionPaths([seinfeld, pilot], "wheel")).toEqual([
      suggestionPath([seinfeld.member, pilot.member]),
    ]);
    expect(suggestionPaths([], "wheel")).toEqual([]);
  });

  it("makes each pick its own show, named by its pick", () => {
    const shows = pickedShows([seinfeld, cheers], inputs({ name: "Ignored" }));
    expect(shows.map((show) => [show.key, show.name, show.label])).toEqual([
      ["collection:c-seinfeld", null, "Seinfeld"],
      ["collection:c-cheers", null, "Cheers"],
    ]);
  });

  it("puts every pick in one wheel, named as typed or by its picks", () => {
    const [named] = pickedShows(
      [seinfeld, cheers],
      inputs({ grouping: "wheel", name: "  Sitcoms  " }),
    );
    expect(named).toMatchObject({ key: "wheel", name: "Sitcoms" });
    expect(named?.label).toBe("Sitcoms");
    expect(named?.members).toEqual([seinfeld.member, cheers.member]);
    const [blank] = pickedShows(
      [seinfeld, cheers],
      inputs({ grouping: "wheel", name: " " }),
    );
    expect(blank).toMatchObject({ name: null, label: "Seinfeld + Cheers" });
  });

  it("plays an item alone once a sitting without waiting for a suggestion", () => {
    const [item] = pickedShows(
      [pilot],
      inputs({}, () => undefined),
    );
    expect(item).toMatchObject({
      hasCollection: false,
      perSitting: { kind: "programs", count: 1 },
      problem: null,
    });
  });

  it("checks a collection's show until its suggestion is read", () => {
    const [show] = pickedShows(
      [seinfeld],
      inputs({}, () => undefined),
    );
    expect(show).toMatchObject({
      suggestion: undefined,
      perSitting: undefined,
      problem: "checking",
    });
  });

  it("sends the suggested per sitting in collection order unless the owner changed them", () => {
    const [suggested] = pickedShows([seinfeld], inputs());
    expect(suggested).toMatchObject({
      mode: "chronological",
      perSitting: { kind: "airtime", minutes: 30 },
      problem: null,
    });
    const [changed] = pickedShows(
      [seinfeld],
      inputs({
        chosen: new Map([
          [
            "collection:c-seinfeld",
            {
              mode: "random",
              stretch: { ...UNCHOSEN_STRETCH, kind: "programs", count: 3 },
            },
          ],
        ]),
      }),
    );
    expect(changed).toMatchObject({
      mode: "random",
      perSitting: { kind: "programs", count: 3 },
    });
  });

  it("asks the owner to choose when the suggestion has none or its read failed", () => {
    const none = pickedShows(
      [seinfeld],
      inputs({}, () => ({ ordinaryStretch: null, contentKind: null })),
    );
    const failed = pickedShows([seinfeld], {
      ...inputs({}, () => undefined),
      suggestions: { get: () => undefined, failed: () => true },
    });
    for (const [show] of [none, failed]) {
      expect(show).toMatchObject({
        suggestion: { ordinaryStretch: null, contentKind: null },
        draft: UNCHOSEN_STRETCH,
        perSitting: undefined,
        problem: "incomplete",
      });
    }
  });

  it("holds a backwards range back", () => {
    const [show] = pickedShows(
      [seinfeld],
      inputs({
        chosen: new Map([
          [
            "collection:c-seinfeld",
            {
              stretch: {
                ...UNCHOSEN_STRETCH,
                kind: "airtime_range",
                minMinutes: 60,
                maxMinutes: 30,
              },
            },
          ],
        ]),
      }),
    );
    expect(show).toMatchObject({ perSitting: undefined, problem: "backwards" });
  });
});

describe("unfinished words", () => {
  // Reads Cheers with no suggestion and Seinfeld with one.
  const readCheersBlank = (path: string) =>
    path === pathOf(cheers)
      ? { ordinaryStretch: null, contentKind: null }
      : halfHour;

  it("says nothing when every show can be sent", () => {
    expect(unfinishedWords(pickedShows([seinfeld, pilot], inputs()))).toBe(
      undefined,
    );
  });

  it("says nothing while a suggestion is still being read", () => {
    // Seinfeld needs choosing, but Cheers's field has not appeared yet.
    const shows = pickedShows(
      [seinfeld, cheers],
      inputs({}, (path) =>
        path === pathOf(cheers)
          ? undefined
          : { ordinaryStretch: null, contentKind: null },
      ),
    );
    expect(unfinishedWords(shows)).toBe(undefined);
  });

  it("names the one show to choose for", () => {
    const shows = pickedShows([seinfeld, cheers], inputs({}, readCheersBlank));
    expect(unfinishedWords(shows)).toBe(
      "Choose how much plays at a time for Cheers.",
    );
  });

  it("counts several shows and names what each needs fixed", () => {
    const backwards = {
      stretch: {
        ...UNCHOSEN_STRETCH,
        kind: "airtime_range" as const,
        minMinutes: 60,
        maxMinutes: 30,
      },
    };
    const third: FoundMember = {
      member: { kind: "collection", mediaCollectionId: "c-frasier" },
      name: "Frasier",
      detail: "Collection",
    };
    const shows = pickedShows(
      [seinfeld, cheers, third],
      inputs(
        { chosen: new Map([["collection:c-seinfeld", backwards]]) },
        () => ({ ordinaryStretch: null, contentKind: null }),
      ),
    );
    expect(unfinishedWords(shows)).toBe(
      "Choose how much plays at a time for 2 shows: Cheers, Frasier. Make At most minutes no less than At least minutes for Seinfeld.",
    );
  });
});

describe("assignments Add sends", () => {
  it("sends each show in normal rotation with marathons off", () => {
    const shows = pickedShows([seinfeld, pilot], inputs());
    expect(toAssignments(shows)).toEqual([
      {
        name: null,
        participation: "default",
        playbackMode: "chronological",
        ordinaryStretch: { kind: "airtime", minutes: 30 },
        marathonStretch: null,
        members: [seinfeld.member],
      },
      {
        name: null,
        participation: "default",
        playbackMode: null,
        ordinaryStretch: { kind: "programs", count: 1 },
        marathonStretch: null,
        members: [pilot.member],
      },
    ]);
  });

  it("sends a named wheel as one show", () => {
    const shows = pickedShows(
      [seinfeld, cheers],
      inputs({ grouping: "wheel", name: "Sitcoms" }),
    );
    expect(toAssignments(shows)).toEqual([
      expect.objectContaining({
        name: "Sitcoms",
        members: [seinfeld.member, cheers.member],
      }),
    ]);
  });
});
