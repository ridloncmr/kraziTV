// @vitest-environment jsdom
import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { SourceAssignment } from "../../http/contracts/programming.js";
import {
  adminFixtures,
  collectionWith,
  favoritesAssignment,
} from "../../testing/admin-fixtures.js";
import { BrowserApi } from "../../testing/browser-api.js";
import { openChannelTab } from "../../testing/channel-tabs.js";
import { chooseOption, chosenOption } from "../../testing/choose-option.js";
import { ChannelWindows } from "../../testing/channel-windows.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ASSIGNMENTS = "/channels/one/programming-assignments";
const ASSIGNMENT = `${ASSIGNMENTS}/assignment`;

// The Lineup tab over `assignments` and the fixture collections plus
// `extra`; `setup` adds replies the tab reads as it opens.
async function openLineup(
  assignments: SourceAssignment[],
  extra: ReturnType<typeof collectionWith>[] = [],
  setup: (api: BrowserApi) => void = () => undefined,
) {
  const api = new BrowserApi();
  api.reply(ASSIGNMENTS, assignments);
  api.reply("/media-collections", [...adminFixtures.collections, ...extra]);
  setup(api);
  vi.stubGlobal("fetch", api.fetch);
  const view = await openChannelTab(api, "Lineup");
  return { api, view };
}

// Selects the named show's row and opens it in Properties.
async function openProperties(name = "Favorites") {
  fireEvent.click(await screen.findByRole("button", { name }));
  fireEvent.click(screen.getByRole("button", { name: "Properties" }));
  return screen.getByRole("dialog", { name });
}

// Shows one tab of a show's Properties dialog.
function openTab(
  dialog: HTMLElement,
  name: "General" | "Contents" | "Up Next",
) {
  fireEvent.click(within(dialog).getByRole("tab", { name }));
}

// Answers a PATCH of the favorites show with `saved`, and lists it afterwards.
function savesAs(api: BrowserApi, saved: () => SourceAssignment) {
  api.handle(
    ASSIGNMENT,
    () => {
      api.reply(ASSIGNMENTS, [saved()]);
      return api.response(saved());
    },
    "PATCH",
  );
}

const REBUILD = "Rebuild the schedule";

// Answers the rebuild choice a lineup change offers with Let it finish,
// which the change already applied, so nothing more is sent.
async function letItFinish(api: BrowserApi) {
  const dialog = await screen.findByRole("dialog", { name: REBUILD });
  fireEvent.click(within(dialog).getByRole("button", { name: "Rebuild" }));
  await within(dialog).findByText(/rebuilt after what is airing now/);
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.requestsTo("/channels/one/schedule/generate")).toEqual([]);
}

const perSitting = (dialog: HTMLElement) =>
  within(dialog).getByLabelText<HTMLSelectElement>("Plays at a time");
const patches = (api: BrowserApi) =>
  api.requestsTo(ASSIGNMENT).filter((request) => request.method === "PATCH");

it("lists each show's name, order, per sitting, marathons, and rotation, with no reorder controls", async () => {
  const { api } = await openLineup(
    [
      favoritesAssignment("episode", {
        ordinaryStretch: { kind: "airtime", minutes: 60 },
        marathonStretch: { kind: "airtime", minutes: 180 },
      }),
      favoritesAssignment("random", {
        id: "sitcoms",
        members: ["office", "parks", "cheers"].map((mediaCollectionId) => ({
          kind: "collection" as const,
          mediaCollectionId,
        })),
      }),
      {
        id: "alpha",
        name: null,
        participation: "rule_only",
        playbackMode: null,
        ordinaryStretch: { kind: "programs", count: 1 },
        marathonStretch: null,
        members: [{ kind: "media_item", mediaItemId: "z" }],
      },
    ],
    [
      collectionWith("office", "The Office"),
      collectionWith("parks", "Parks"),
      collectionWith("cheers", "Cheers"),
    ],
    (api) => api.reply("/media-items/z", adminFixtures.media[0]),
  );
  const table = await screen.findByRole("table", { name: "Shows" });

  await waitFor(() =>
    expect(
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((row) =>
          [...(row as HTMLTableRowElement).cells]
            .slice(0, 5)
            .map((cell) => cell.textContent),
        ),
    ).toEqual([
      ["Favorites", "Episode order", "~1 hr", "up to 3 hrs", ""],
      ["The Office + Parks + 1 more", "Random", "3 programs", "", "Wheel"],
      ["Alpha", "—", "1 program", "", "Rules only"],
    ]),
  );
  expect(screen.queryByRole("button", { name: /Move/ })).toBeNull();
  expect(screen.queryByRole("group", { name: /Assignment/ })).toBeNull();
  expect(api.requestsTo(`${ASSIGNMENTS}/order`)).toEqual([]);
});

it.each([
  ["episode", /Plays season by season, episode by episode/],
  ["release", /Plays oldest first, by release or air date/],
] as const)(
  "saves %s order from Properties, explains it, and shows it when reopened",
  async (playbackMode, hint) => {
    const { api } = await openLineup([favoritesAssignment("chronological")]);
    savesAs(api, () => favoritesAssignment(playbackMode));
    const dialog = await openProperties();
    const order =
      within(dialog).getByLabelText<HTMLSelectElement>("Play order");
    expect(
      within(order)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Collection order", "Episode order", "Release order", "Random"]);

    fireEvent.change(order, { target: { value: playbackMode } });
    const hintId = order.getAttribute("aria-describedby");
    expect(document.getElementById(hintId!)?.textContent).toMatch(hint);
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Favorites" })).toBeNull(),
    );
    expect(patches(api)[0]?.body).toEqual({
      name: null,
      participation: "default",
      playbackMode,
      ordinaryStretch: { kind: "programs", count: 3 },
      marathonStretch: null,
      members: [{ kind: "collection", mediaCollectionId: "favorites" }],
    });
    await waitFor(() => expect(api.readAfterLastWrite(ASSIGNMENTS)).toBe(true));
    const reopened = await openProperties();
    expect(
      within(reopened).getByLabelText<HTMLSelectElement>("Play order").value,
    ).toBe(playbackMode);
  },
);

it("keeps an unsaved order across minimize and restore", async () => {
  const { api, view } = await openLineup([
    favoritesAssignment("chronological"),
  ]);
  const dialog = await openProperties();
  fireEvent.change(within(dialog).getByLabelText("Play order"), {
    target: { value: "random" },
  });

  view.rerender(createElement(ChannelWindows, { visible: false }));
  view.rerender(createElement(ChannelWindows));

  await waitFor(() => expect(api.requestsTo(ASSIGNMENTS)).toHaveLength(2));
  expect(
    within(
      screen.getByRole("dialog", { name: "Favorites" }),
    ).getByLabelText<HTMLSelectElement>("Play order").value,
  ).toBe("random");
});

it("discards every change on Cancel, so reopening shows the saved settings", async () => {
  const { api } = await openLineup([favoritesAssignment("chronological")]);
  const dialog = await openProperties();
  chooseOption(perSitting(dialog), "1 program");
  fireEvent.click(
    within(dialog).getByLabelText("Only air when a rule picks it"),
  );

  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

  expect(screen.queryByRole("dialog")).toBeNull();
  const reopened = await openProperties();
  expect(chosenOption(perSitting(reopened))).toBe("3 programs");
  expect(
    within(reopened).getByLabelText<HTMLInputElement>(
      "Only air when a rule picks it",
    ).checked,
  ).toBe(false);
  expect(patches(api)).toEqual([]);
});

it("saves on Apply and stays open, then saves on OK and closes", async () => {
  const { api } = await openLineup([favoritesAssignment("chronological")]);
  let stretch: SourceAssignment["ordinaryStretch"] = {
    kind: "programs",
    count: 3,
  };
  savesAs(api, () =>
    favoritesAssignment("chronological", { ordinaryStretch: stretch }),
  );
  const dialog = await openProperties();

  chooseOption(perSitting(dialog), "1 program");
  stretch = { kind: "programs", count: 1 };
  fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
  await waitFor(() => expect(api.readAfterLastWrite(ASSIGNMENTS)).toBe(true));
  expect(screen.getByRole("dialog", { name: "Favorites" })).toBe(dialog);
  await screen.findByRole("cell", { name: "1 program" });
  // The rebuild choice waits until the show's dialog closes.
  expect(screen.queryByRole("dialog", { name: REBUILD })).toBeNull();

  chooseOption(perSitting(dialog), "~1 hr");
  stretch = { kind: "airtime", minutes: 60 };
  fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));

  await letItFinish(api);
  expect(patches(api).map((request) => request.body)).toEqual([
    expect.objectContaining({
      ordinaryStretch: { kind: "programs", count: 1 },
    }),
    expect.objectContaining({
      ordinaryStretch: { kind: "airtime", minutes: 60 },
    }),
  ]);
});

it("opens Properties by double-click, by Enter, and from the row menu", async () => {
  await openLineup([favoritesAssignment("chronological")]);
  const row = (
    await screen.findByRole("button", { name: "Favorites" })
  ).closest("tr")!;
  const opens = () => {
    const dialog = screen.getByRole("dialog", { name: "Favorites" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  };

  fireEvent.doubleClick(row);
  opens();
  fireEvent.keyDown(row, { key: "Enter" });
  opens();
  fireEvent.click(
    within(row).getByRole("button", { name: "Actions for Favorites" }),
  );
  expect(
    screen.getAllByRole("menuitem").map((item) => item.textContent),
  ).toEqual(["Properties", "Remove…"]);
  fireEvent.click(screen.getByRole("menuitem", { name: "Properties" }));
  opens();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("removes a show only after a confirmation that names it", async () => {
  const { api } = await openLineup([favoritesAssignment("chronological")]);
  api.handle(
    ASSIGNMENT,
    () => {
      api.reply(ASSIGNMENTS, []);
      return api.response(undefined, 204);
    },
    "DELETE",
  );
  const remove = screen.getByRole<HTMLButtonElement>("button", {
    name: "Remove…",
  });
  expect(remove.disabled).toBe(true);
  fireEvent.click(await screen.findByRole("button", { name: "Favorites" }));

  fireEvent.click(remove);
  const confirm = screen.getByRole("dialog", { name: "Remove show" });
  expect(confirm.textContent).toMatch(/Remove Favorites from this lineup/);
  fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
  expect(api.requestsTo(ASSIGNMENT)).toEqual([]);

  fireEvent.click(remove);
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Remove show" })).getByRole(
      "button",
      { name: "Remove" },
    ),
  );

  await screen.findByText(/No shows yet/);
  expect(api.requestsTo(ASSIGNMENT).map((request) => request.method)).toEqual([
    "DELETE",
  ]);

  // Removal offers the rebuild choice; stopping now rebuilds from now.
  api.reply("/channels/one/programming/rebuild", { stopFailed: false }, "POST");
  const rebuild = await screen.findByRole("dialog", { name: REBUILD });
  fireEvent.click(
    within(rebuild).getByRole("radio", {
      name: "Stop it now and rebuild the schedule",
    }),
  );
  fireEvent.click(within(rebuild).getByRole("button", { name: "Rebuild" }));
  await within(rebuild).findByText(/rebuilt from now/);
  expect(api.requestsTo("/channels/one/programming/rebuild")).toHaveLength(1);
});

it("derives the marathon length from per sitting once the show can marathon", async () => {
  const { api } = await openLineup([favoritesAssignment("chronological")]);
  const dialog = await openProperties();

  fireEvent.click(within(dialog).getByLabelText("Allow marathons"));
  within(dialog).getByText(/up to 6 programs/);
  chooseOption(perSitting(dialog), "1 program");
  within(dialog).getByText(/up to 2 programs/);
  fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));

  await waitFor(() => expect(patches(api)).toHaveLength(1));
  expect(patches(api)[0]?.body).toMatchObject({
    ordinaryStretch: { kind: "programs", count: 1 },
    marathonStretch: { kind: "programs", count: 2 },
  });
});

it("keeps a saved marathon length override on General, and returns to the derived length when it is cleared", async () => {
  const { api } = await openLineup([
    favoritesAssignment("chronological", {
      marathonStretch: { kind: "airtime", minutes: 240 },
    }),
  ]);
  const dialog = await openProperties();
  within(dialog).getByText(/up to 4 hrs/);
  const override = within(dialog).getByLabelText<HTMLInputElement>(
    "Choose the marathon length",
  );
  expect(override.checked).toBe(true);
  expect(
    within(dialog).getByLabelText<HTMLInputElement>("Marathon minutes per turn")
      .value,
  ).toBe("240");
  fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
  await waitFor(() => expect(patches(api)).toHaveLength(1));

  fireEvent.click(override);
  within(dialog).getByText(/up to 6 programs/);
  fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));

  await waitFor(() => expect(patches(api)).toHaveLength(2));
  expect(patches(api).map((request) => request.body)).toEqual([
    expect.objectContaining({
      marathonStretch: { kind: "airtime", minutes: 240 },
    }),
    expect.objectContaining({
      marathonStretch: { kind: "programs", count: 6 },
    }),
  ]);
});

it("saves a show kept out of normal rotation and lists it as Rules only", async () => {
  const { api } = await openLineup([favoritesAssignment("chronological")]);
  savesAs(api, () =>
    favoritesAssignment("chronological", { participation: "rule_only" }),
  );
  const dialog = await openProperties();

  fireEvent.click(
    within(dialog).getByLabelText("Only air when a rule picks it"),
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));

  await screen.findByText("Rules only");
  expect(patches(api)[0]?.body).toMatchObject({ participation: "rule_only" });
  const reopened = await openProperties();
  expect(
    within(reopened).getByLabelText<HTMLInputElement>(
      "Only air when a rule picks it",
    ).checked,
  ).toBe(true);
});

it("refreshes the collection preview when the order changes", async () => {
  const { api } = await openLineup([favoritesAssignment("chronological")]);
  const member = (title: string, flags: Record<string, boolean> = {}) => ({
    mediaItemId: title,
    title,
    seriesName: "The Office",
    seasonNumber: 1,
    episodeNumber: title === "Pilot" ? 1 : 2,
    releaseDate: null,
    unresolved: false,
    startsSeriesGroup: false,
    duplicateEpisode: false,
    ...flags,
  });
  // The server answers each mode with its own order, as the route does.
  api.handle(`${ASSIGNMENT}/preview`, (request) => {
    const playbackMode = request.query.get("playbackMode");
    return api.response({
      playbackMode,
      ordered:
        playbackMode === "random"
          ? null
          : playbackMode === "episode"
            ? [
                member("Pilot", { startsSeriesGroup: true }),
                member("Diversity Day"),
              ]
            : [member("Diversity Day"), member("Pilot")],
      upcoming:
        playbackMode === "chronological"
          ? [
              {
                id: "entry-1",
                mediaItemId: "Diversity Day",
                title: "Diversity Day",
                startsAt: "2026-10-14T20:00:00.000Z",
                endsAt: "2026-10-14T20:22:00.000Z",
              },
            ]
          : null,
    });
  });
  const dialog = await openProperties();
  openTab(dialog, "Up Next");
  const playOrder = async () =>
    within(await within(dialog).findByRole("list", { name: "Play order" }))
      .getAllByRole("listitem")
      .map((item) => item.textContent);

  await waitFor(async () =>
    expect(await playOrder()).toEqual([
      expect.stringContaining("Diversity Day"),
      expect.stringContaining("Pilot"),
    ]),
  );
  expect(
    within(dialog).getByRole("list", { name: "Upcoming selections" })
      .textContent,
  ).toContain("Diversity Day");

  openTab(dialog, "General");
  fireEvent.change(within(dialog).getByLabelText("Play order"), {
    target: { value: "episode" },
  });
  openTab(dialog, "Up Next");
  await waitFor(async () =>
    expect(await playOrder()).toEqual([
      expect.stringContaining("The Office: Pilot"),
      expect.stringContaining("Diversity Day"),
    ]),
  );
  within(dialog).getByText("Save this mode to see its upcoming selections.");

  openTab(dialog, "General");
  fireEvent.change(within(dialog).getByLabelText("Play order"), {
    target: { value: "random" },
  });
  openTab(dialog, "Up Next");
  await within(dialog).findByText(/Random has no fixed order/);
  expect(
    api
      .requestsTo(`${ASSIGNMENT}/preview`)
      .map((request) => [
        request.query.get("mediaCollectionId"),
        request.query.get("playbackMode"),
      ]),
  ).toEqual([
    ["favorites", "chronological"],
    ["favorites", "episode"],
    ["favorites", "random"],
  ]);
});

it("confirms restarting from the beginning in its own dialog; cancel sends nothing", async () => {
  const { api } = await openLineup([favoritesAssignment("episode")]);
  const upcoming = (title: string) => ({
    playbackMode: "episode",
    ordered: [],
    upcoming: [
      {
        id: `entry-${title}`,
        mediaItemId: title,
        title,
        startsAt: "2026-10-14T20:00:00.000Z",
        endsAt: "2026-10-14T20:22:00.000Z",
      },
    ],
  });
  const RESET = `${ASSIGNMENT}/progress-reset`;
  api.reply(`${ASSIGNMENT}/preview`, upcoming("Mid-season"));
  api.handle(
    RESET,
    () => {
      api.reply(`${ASSIGNMENT}/preview`, upcoming("Pilot"));
      return api.response(undefined, 204);
    },
    "POST",
  );
  const properties = await openProperties();
  openTab(properties, "Up Next");
  const restart = await within(properties).findByRole("button", {
    name: "Restart from the beginning…",
  });
  const resetDialog = () =>
    screen.getByRole("dialog", { name: "Restart from the beginning" });

  fireEvent.click(restart);
  expect(resetDialog().textContent).toMatch(
    /every later schedule entry is regenerated/,
  );
  fireEvent.click(
    within(resetDialog()).getByRole("button", { name: "Cancel" }),
  );
  expect(
    screen.queryByRole("dialog", { name: "Restart from the beginning" }),
  ).toBeNull();
  expect(api.requestsTo(RESET)).toEqual([]);

  fireEvent.click(restart);
  fireEvent.click(
    within(resetDialog()).getByRole("button", { name: "Restart progress" }),
  );

  // The pre-reset list must never stand in for the regenerated one.
  await within(resetDialog()).findByText(/restarts in episode order/);
  expect(resetDialog().textContent).not.toContain("Mid-season");
  await waitFor(() =>
    expect(
      within(resetDialog()).getByRole("list", { name: "Upcoming selections" })
        .textContent,
    ).toContain("Pilot"),
  );
  expect(api.requestsTo(RESET).map((request) => request.body)).toEqual([
    { mediaCollectionId: "favorites" },
  ]);
  expect(patches(api)).toEqual([]);
});

it("words per-sitting presets in movies for a movie show and in episodes for an episode show, in Properties and the lineup", async () => {
  await openLineup(
    [
      favoritesAssignment("release", {
        ordinaryStretch: { kind: "programs", count: 1 },
      }),
      favoritesAssignment("episode", {
        id: "other",
        members: [{ kind: "collection", mediaCollectionId: "other" }],
      }),
    ],
    [collectionWith("other", "Other")],
    (api) =>
      api.handle("/programming-assignments/stretch-suggestion", (request) =>
        api.response(
          request.query.get("mediaCollectionIds") === "favorites"
            ? {
                ordinaryStretch: { kind: "programs", count: 1 },
                contentKind: "movies",
              }
            : {
                ordinaryStretch: { kind: "programs", count: 3 },
                contentKind: "episodes",
              },
        ),
      ),
  );
  const options = (dialog: HTMLElement) =>
    within(perSitting(dialog))
      .getAllByRole("option")
      .map((option) => option.textContent);

  await screen.findByRole("cell", { name: "1 movie" });
  await screen.findByRole("cell", { name: "3 episodes" });
  const movies = await openProperties("Favorites");
  await waitFor(() => expect(chosenOption(perSitting(movies))).toBe("1 movie"));
  expect(options(movies)).toEqual([
    "Choose…",
    "1 movie",
    "2 movies",
    "3 movies",
    "Custom…",
  ]);
  fireEvent.click(within(movies).getByRole("button", { name: "Cancel" }));
  const episodes = await openProperties("Other");
  await waitFor(() =>
    expect(chosenOption(perSitting(episodes))).toBe("3 episodes"),
  );
  expect(options(episodes)).toEqual([
    "Choose…",
    "1 episode",
    "3 episodes",
    "~30 min",
    "~1 hr",
    "~2 hrs",
    "Custom…",
  ]);
  chooseOption(perSitting(episodes), "~1 hr");
  within(episodes).getByText(/runs over/);
});

it("round-trips a custom per sitting as Custom, in words in the lineup", async () => {
  const range = {
    kind: "airtime_range" as const,
    minMinutes: 45,
    maxMinutes: 90,
  };
  const { api } = await openLineup([
    favoritesAssignment("chronological", { ordinaryStretch: range }),
  ]);

  await screen.findByRole("cell", { name: "45 min to 1 hr 30 min" });
  const dialog = await openProperties();
  expect(chosenOption(perSitting(dialog))).toBe("Custom");
  expect(
    within(dialog).getByLabelText<HTMLInputElement>("At least minutes").value,
  ).toBe("45");
  expect(
    within(dialog).getByLabelText<HTMLInputElement>("At most minutes").value,
  ).toBe("90");
  fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));

  await waitFor(() => expect(patches(api)).toHaveLength(1));
  expect(patches(api)[0]?.body).toMatchObject({ ordinaryStretch: range });
});

it("returns to General instead of saving when a General field is left empty on another tab", async () => {
  const { api } = await openLineup([favoritesAssignment("chronological")]);
  const dialog = await openProperties();
  chooseOption(perSitting(dialog), "Custom…");
  fireEvent.change(within(dialog).getByLabelText("Programs per turn"), {
    target: { value: "" },
  });
  openTab(dialog, "Contents");

  fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));

  expect(
    within(dialog).getByRole("tab", { name: "General" }).ariaSelected,
  ).toBe("true");
  // An emptied count matches no preset, so the required select asks again.
  expect(perSitting(dialog).validity.valid).toBe(false);
  expect(patches(api)).toEqual([]);
});

const SETTINGS = "/channels/one/programming-settings";
const marathonShow = favoritesAssignment("chronological", {
  marathonStretch: { kind: "programs", count: 6 },
});

// Answers the channel's marathon settings, saving each PUT as the server does.
function serveSettings(
  api: BrowserApi,
  initial: { marathonChancePercent: number; marathonMinOrdinaryRounds: number },
) {
  api.reply(SETTINGS, initial);
  api.handle(
    SETTINGS,
    (request) => {
      api.reply(SETTINGS, request.body);
      return api.response(request.body);
    },
    "PUT",
  );
}
const settingsWrites = (api: BrowserApi) =>
  api
    .requestsTo(SETTINGS)
    .filter((request) => request.method === "PUT")
    .map((request) => request.body);
const marathonsSelect = () =>
  within(
    screen.getByRole("region", { name: "Marathons" }),
  ).getByLabelText<HTMLSelectElement>("Marathons");

it("saves each marathon preset as soon as it is chosen", async () => {
  const { api } = await openLineup([marathonShow], [], (api) =>
    serveSettings(api, {
      marathonChancePercent: 0,
      marathonMinOrdinaryRounds: 3,
    }),
  );
  await waitFor(() => expect(marathonsSelect().disabled).toBe(false));
  expect(chosenOption(marathonsSelect())).toBe("Off");

  chooseOption(marathonsSelect(), "Occasional");
  await waitFor(() =>
    expect(chosenOption(marathonsSelect())).toBe("Occasional"),
  );
  chooseOption(marathonsSelect(), "Frequent");
  await waitFor(() => expect(chosenOption(marathonsSelect())).toBe("Frequent"));
  chooseOption(marathonsSelect(), "Off");
  await waitFor(() => expect(chosenOption(marathonsSelect())).toBe("Off"));

  // Off keeps the saved cooldown; only the chance drops to zero.
  expect(settingsWrites(api)).toEqual([
    { marathonChancePercent: 10, marathonMinOrdinaryRounds: 2 },
    { marathonChancePercent: 25, marathonMinOrdinaryRounds: 1 },
    { marathonChancePercent: 0, marathonMinOrdinaryRounds: 1 },
  ]);
  await letItFinish(api);
});

it("shows unmatched settings as Custom and edits them in the Custom dialog through Edit…", async () => {
  const { api } = await openLineup([marathonShow], [], (api) =>
    serveSettings(api, {
      marathonChancePercent: 40,
      marathonMinOrdinaryRounds: 3,
    }),
  );
  await waitFor(() => expect(chosenOption(marathonsSelect())).toBe("Custom"));
  const custom = () => screen.getByRole("dialog", { name: "Custom marathons" });
  const chance = () =>
    within(custom()).getByLabelText<HTMLInputElement>("Chance per round (%)");

  // Choosing the Custom already shown opens nothing in a browser; Edit… does.
  fireEvent.click(
    screen.getByRole("button", { name: "Edit custom marathons" }),
  );
  expect(chance().value).toBe("40");
  fireEvent.change(chance(), { target: { value: "50" } });
  fireEvent.click(within(custom()).getByRole("button", { name: "Cancel" }));
  expect(settingsWrites(api)).toEqual([]);

  fireEvent.click(
    screen.getByRole("button", { name: "Edit custom marathons" }),
  );
  expect(chance().value).toBe("40");
  fireEvent.change(chance(), { target: { value: "50" } });
  fireEvent.click(within(custom()).getByRole("button", { name: "OK" }));

  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Custom marathons" }),
    ).toBeNull(),
  );
  expect(settingsWrites(api)).toEqual([
    { marathonChancePercent: 50, marathonMinOrdinaryRounds: 3 },
  ]);
  expect(chosenOption(marathonsSelect())).toBe("Custom");
});

it("disables the marathon control until some show can marathon", async () => {
  await openLineup([favoritesAssignment("chronological")], [], (api) =>
    serveSettings(api, {
      marathonChancePercent: 10,
      marathonMinOrdinaryRounds: 2,
    }),
  );

  await screen.findByText("No show allows marathons yet.");
  expect(marathonsSelect().disabled).toBe(true);
});

it("marks a marathon-capable show (off) while channel marathons are off", async () => {
  await openLineup([marathonShow], [], (api) =>
    serveSettings(api, {
      marathonChancePercent: 0,
      marathonMinOrdinaryRounds: 2,
    }),
  );

  await screen.findByRole("cell", { name: "up to 6 programs (off)" });
  chooseOption(marathonsSelect(), "Occasional");
  await screen.findByRole("cell", { name: "up to 6 programs" });
});

it("offers to turn channel marathons on when a show can marathon while they are off, and never changes them on OK", async () => {
  const { api } = await openLineup(
    [favoritesAssignment("chronological")],
    [],
    (api) =>
      serveSettings(api, {
        marathonChancePercent: 0,
        marathonMinOrdinaryRounds: 2,
      }),
  );
  savesAs(api, () => marathonShow);
  const dialog = await openProperties();
  await waitFor(() => expect(api.requestsTo(SETTINGS)).toHaveLength(1));
  expect(within(dialog).queryByText(/Marathons are off/)).toBeNull();

  fireEvent.click(within(dialog).getByLabelText("Allow marathons"));
  within(dialog).getByText("Marathons are off for this channel.");
  fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));

  await waitFor(() => expect(patches(api)).toHaveLength(1));
  expect(patches(api)[0]?.body).toMatchObject({
    marathonStretch: { kind: "programs", count: 6 },
  });
  expect(settingsWrites(api)).toEqual([]);

  await letItFinish(api);
  const reopened = await openProperties();
  // The saved show can marathon, so the notice shows as it opens.
  within(reopened).getByText("Marathons are off for this channel.");
  fireEvent.click(
    within(reopened).getByRole("button", {
      name: "Turn on occasional marathons",
    }),
  );

  await within(reopened).findByText(
    "Occasional marathons are now on for this channel.",
  );
  await waitFor(() =>
    expect(within(reopened).queryByText(/Marathons are off/)).toBeNull(),
  );
  expect(settingsWrites(api)).toEqual([
    { marathonChancePercent: 10, marathonMinOrdinaryRounds: 2 },
  ]);
  expect(patches(api)).toHaveLength(1);
});

// The checkbox the combined search shows for a result named `name`.
const result = (scope: HTMLElement, name: string) =>
  within(
    within(scope).getByRole("list", { name: "Search results" }),
  ).getByRole<HTMLInputElement>("checkbox", { name: new RegExp(`^${name} `) });

// Toggles the combined search to `kind`: collections or single items.
const searchFor = (scope: HTMLElement, kind: "Collections" | "Single items") =>
  fireEvent.click(within(scope).getByRole("radio", { name: kind }));

// Answers suggestions by collection: Favorites holds episodes, Movies holds
// movies, and Mixed has no suggestion.
function serveSuggestions(api: BrowserApi) {
  api.handle("/programming-assignments/stretch-suggestion", (request) => {
    const id = request.query.get("mediaCollectionIds");
    return api.response(
      id === "movies"
        ? {
            ordinaryStretch: { kind: "programs", count: 1 },
            contentKind: "movies",
          }
        : id === "mixed"
          ? { ordinaryStretch: null, contentKind: null }
          : {
              ordinaryStretch: { kind: "programs", count: 3 },
              contentKind: "episodes",
            },
    );
  });
  api.reply("/media-items", { items: adminFixtures.media, total: 2 });
}
const BATCH = `${ASSIGNMENTS}/batch`;

// The box Add shows' settings page holds for the show named `name`.
const showRow = (dialog: HTMLElement, name: string) =>
  within(dialog).getByRole("group", { name });

// Turns Add shows to its settings page through Next, which counts the picks.
const next = (dialog: HTMLElement, picks: number) =>
  fireEvent.click(
    within(dialog).getByRole("button", { name: `Next (${picks})` }),
  );

// Returns from Add shows' settings page to the picks.
const back = (dialog: HTMLElement) =>
  fireEvent.click(within(dialog).getByRole("button", { name: "Back" }));

it("adds three picks as three shows in one request, each with its suggested per sitting", async () => {
  const { api } = await openLineup(
    [],
    [collectionWith("movies", "Movies")],
    serveSuggestions,
  );
  api.handle(
    BATCH,
    (request) => {
      const { assignments } = request.body as { assignments: object[] };
      api.reply(
        ASSIGNMENTS,
        assignments.map((settings, index) => ({
          ...settings,
          id: `show-${index}`,
        })),
      );
      return api.response([], 201);
    },
    "POST",
  );
  fireEvent.click(await screen.findByRole("button", { name: "Add shows…" }));
  const dialog = screen.getByRole("dialog", { name: "Add shows" });
  expect(
    within(dialog).getByRole<HTMLButtonElement>("button", { name: "Next" })
      .disabled,
  ).toBe(true);

  fireEvent.click(result(dialog, "Favorites"));
  fireEvent.click(result(dialog, "Movies"));
  searchFor(dialog, "Single items");
  fireEvent.click(
    await within(dialog).findByRole("checkbox", { name: /^Alpha / }),
  );
  next(dialog, 3);
  const add = within(dialog).getByRole<HTMLButtonElement>("button", {
    name: "Add (3)",
  });
  // Each show lists collection order and its suggested per sitting.
  await waitFor(() =>
    expect(chosenOption(perSitting(showRow(dialog, "Movies")))).toBe("1 movie"),
  );
  const favorites = showRow(dialog, "Favorites");
  expect(chosenOption(within(favorites).getByLabelText("Play order"))).toBe(
    "Collection order",
  );
  expect(chosenOption(perSitting(favorites))).toBe("3 episodes");
  // A single item has no order or per sitting to choose.
  const alpha = showRow(dialog, "Alpha");
  within(alpha).getByText("Plays one item each time it comes up.");
  expect(within(alpha).queryByLabelText("Play order")).toBeNull();
  expect(within(alpha).queryByLabelText("Plays at a time")).toBeNull();
  await waitFor(() => expect(add.disabled).toBe(false));
  fireEvent.click(add);

  await letItFinish(api);
  await screen.findByRole("button", { name: "Movies" });
  expect(api.requestsTo(BATCH).map((request) => request.body)).toEqual([
    {
      assignments: [
        {
          name: null,
          participation: "default",
          playbackMode: "chronological",
          ordinaryStretch: { kind: "programs", count: 3 },
          marathonStretch: null,
          members: [{ kind: "collection", mediaCollectionId: "favorites" }],
        },
        {
          name: null,
          participation: "default",
          playbackMode: "chronological",
          ordinaryStretch: { kind: "programs", count: 1 },
          marathonStretch: null,
          members: [{ kind: "collection", mediaCollectionId: "movies" }],
        },
        {
          name: null,
          participation: "default",
          playbackMode: null,
          ordinaryStretch: { kind: "programs", count: 1 },
          marathonStretch: null,
          members: [{ kind: "media_item", mediaItemId: "z" }],
        },
      ],
    },
  ]);
  expect(
    api.requestsTo(ASSIGNMENTS).filter((request) => request.method === "POST"),
  ).toEqual([]);
});

it("asks for per sitting before Add for a pick with no suggestion", async () => {
  const { api } = await openLineup(
    [],
    [collectionWith("mixed", "Mixed")],
    serveSuggestions,
  );
  api.reply(BATCH, [], "POST", 201);
  fireEvent.click(await screen.findByRole("button", { name: "Add shows…" }));
  const dialog = screen.getByRole("dialog", { name: "Add shows" });
  fireEvent.click(result(dialog, "Mixed"));
  next(dialog, 1);
  const add = within(dialog).getByRole<HTMLButtonElement>("button", {
    name: "Add (1)",
  });
  const choice =
    await within(dialog).findByLabelText<HTMLSelectElement>("Plays at a time");
  expect(showRow(dialog, "Mixed").contains(choice)).toBe(true);
  expect(chosenOption(choice)).toBe("Choose…");
  expect(add.disabled).toBe(true);
  chooseOption(choice, "~1 hr");
  expect(add.disabled).toBe(false);
  fireEvent.click(add);

  await waitFor(() => expect(api.requestsTo(BATCH)).toHaveLength(1));
  expect(api.requestsTo(BATCH)[0]?.body).toMatchObject({
    assignments: [{ ordinaryStretch: { kind: "airtime", minutes: 60 } }],
  });
});

it("adds a show with the play order and per sitting chosen in Add shows", async () => {
  const { api } = await openLineup(
    [],
    [collectionWith("movies", "Movies")],
    serveSuggestions,
  );
  api.reply(BATCH, [], "POST", 201);
  fireEvent.click(await screen.findByRole("button", { name: "Add shows…" }));
  const dialog = screen.getByRole("dialog", { name: "Add shows" });

  fireEvent.click(result(dialog, "Movies"));
  next(dialog, 1);
  const movies = () => showRow(dialog, "Movies");
  chooseOption(within(movies()).getByLabelText("Play order"), "Random");
  await waitFor(() =>
    expect(chosenOption(perSitting(movies()))).toBe("1 movie"),
  );
  chooseOption(perSitting(movies()), "2 movies");
  // Back keeps the picks and every choice made for them.
  back(dialog);
  expect(result(dialog, "Movies").checked).toBe(true);
  next(dialog, 1);
  expect(chosenOption(within(movies()).getByLabelText("Play order"))).toBe(
    "Random",
  );
  expect(chosenOption(perSitting(movies()))).toBe("2 movies");
  fireEvent.click(within(dialog).getByRole("button", { name: "Add (1)" }));

  await waitFor(() => expect(api.requestsTo(BATCH)).toHaveLength(1));
  expect(api.requestsTo(BATCH)[0]?.body).toMatchObject({
    assignments: [
      {
        playbackMode: "random",
        ordinaryStretch: { kind: "programs", count: 2 },
        marathonStretch: null,
        participation: "default",
      },
    ],
  });
});

it("keeps every pick and names the refused show when the server refuses the batch", async () => {
  const { api } = await openLineup(
    [favoritesAssignment("chronological")],
    [collectionWith("movies", "Movies")],
    serveSuggestions,
  );
  api.reply(
    BATCH,
    {
      error: {
        code: "media_item_not_found",
        message: "Unknown media items: z",
        index: 1,
      },
    },
    "POST",
    400,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Add shows…" }));
  const dialog = screen.getByRole("dialog", { name: "Add shows" });
  // The lineup already plays Favorites, so it is left out of the results.
  const results = within(dialog).getByRole("list", { name: "Search results" });
  expect(within(results).queryByRole("checkbox", { name: /^Favorites / })).toBe(
    null,
  );
  fireEvent.change(within(dialog).getByLabelText("Find collections"), {
    target: { value: "fav" },
  });
  within(dialog).getByText("Every matching collection is already added.");
  fireEvent.change(within(dialog).getByLabelText("Find collections"), {
    target: { value: "" },
  });

  fireEvent.click(result(dialog, "Movies"));
  searchFor(dialog, "Single items");
  fireEvent.click(
    await within(dialog).findByRole("checkbox", { name: /^Alpha / }),
  );
  next(dialog, 2);
  const add = within(dialog).getByRole<HTMLButtonElement>("button", {
    name: "Add (2)",
  });
  await waitFor(() => expect(add.disabled).toBe(false));
  const listReads = api.requestsTo(ASSIGNMENTS).length;
  fireEvent.click(add);

  expect((await within(dialog).findByRole("alert")).textContent).toMatch(
    /Alpha could not be added: Unknown media items: z/,
  );
  expect(screen.getByRole("dialog", { name: "Add shows" })).toBe(dialog);
  back(dialog);
  expect(result(dialog, "Alpha").checked).toBe(true);
  searchFor(dialog, "Collections");
  expect(result(dialog, "Movies").checked).toBe(true);
  expect(api.requestsTo(ASSIGNMENTS)).toHaveLength(listReads);
});

it("toggles Add shows between collections and filtered single items, keeping picks across the toggle", async () => {
  const { api } = await openLineup([], [], serveSuggestions);
  api.reply("/media-roots", []);
  fireEvent.click(await screen.findByRole("button", { name: "Add shows…" }));
  const dialog = screen.getByRole("dialog", { name: "Add shows" });

  // Collections come first, and no catalog page is read until items are asked for.
  fireEvent.click(result(dialog, "Favorites"));
  expect(within(dialog).queryByRole("checkbox", { name: /^Alpha / })).toBe(
    null,
  );
  expect(api.requestsTo("/media-items")).toEqual([]);

  searchFor(dialog, "Single items");
  await within(dialog).findByRole("checkbox", {
    name: "Alpha /media/alpha.mp4",
  });
  expect(within(dialog).queryByRole("checkbox", { name: /^Favorites / })).toBe(
    null,
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Filter…" }));
  const filter = screen.getByRole("dialog", { name: "Filter media" });
  fireEvent.click(within(filter).getByRole("checkbox", { name: "Missing" }));
  fireEvent.click(within(filter).getByRole("button", { name: "Apply" }));

  expect(screen.queryByRole("dialog", { name: "Filter media" })).toBeNull();
  await waitFor(() =>
    expect(
      api.requestsTo("/media-items").at(-1)?.query.getAll("status"),
    ).toEqual(["missing"]),
  );
  within(dialog).getByRole("button", { name: "Filter (1)…" });
  within(dialog).getByRole("button", { name: "Next (1)" });
  searchFor(dialog, "Collections");
  expect(result(dialog, "Favorites").checked).toBe(true);
});

it("selects every pickable result from the results header, and clears them again", async () => {
  await openLineup(
    [favoritesAssignment("chronological")],
    [collectionWith("movies", "Movies"), collectionWith("mixed", "Mixed")],
    serveSuggestions,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Add shows…" }));
  const dialog = screen.getByRole("dialog", { name: "Add shows" });
  const all = (name: string) =>
    within(dialog).getByRole<HTMLInputElement>("checkbox", { name });

  fireEvent.click(result(dialog, "Movies"));
  // One of two pickable results is checked, so the header reads mixed.
  expect(all("Select all").indeterminate).toBe(true);
  fireEvent.click(all("Select all"));
  expect(result(dialog, "Movies").checked).toBe(true);
  expect(result(dialog, "Mixed").checked).toBe(true);
  expect(all("Select all").checked).toBe(true);
  expect(all("Select all").indeterminate).toBe(false);
  fireEvent.click(all("Select all"));
  expect(result(dialog, "Movies").checked).toBe(false);
  expect(result(dialog, "Mixed").checked).toBe(false);

  searchFor(dialog, "Single items");
  await within(dialog).findByRole("checkbox", { name: /^Alpha / });
  fireEvent.click(all("Select all on this page"));
  expect(result(dialog, "Alpha").checked).toBe(true);
  expect(result(dialog, "Zulu").checked).toBe(true);
  within(dialog).getByRole("button", { name: "Next (2)" });
});

it("keeps a show's last member when select all unchecks every result on Contents", async () => {
  await openLineup(
    [
      favoritesAssignment("chronological", {
        members: [
          { kind: "collection", mediaCollectionId: "favorites" },
          { kind: "collection", mediaCollectionId: "other" },
        ],
      }),
    ],
    [collectionWith("other", "Other")],
  );
  const dialog = await openProperties("Favorites + Other");
  openTab(dialog, "Contents");
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Select all" }));

  expect(
    within(within(dialog).getByRole("list", { name: "In this show" }))
      .getAllByRole("listitem")
      .map((row) => row.firstChild?.textContent),
  ).toEqual(["Other"]);
});

it("adds an item and a collection as members on Contents through the combined search, and reorders them", async () => {
  const { api } = await openLineup(
    [favoritesAssignment("chronological")],
    [collectionWith("other", "Other")],
    (api) =>
      api.reply("/media-items", { items: adminFixtures.media, total: 2 }),
  );
  const dialog = await openProperties();
  openTab(dialog, "Contents");
  within(dialog).getByText(/add it to the lineup as a separate show/);
  // The only member stays, so it cannot be unchecked.
  expect(result(dialog, "Favorites").disabled).toBe(true);

  fireEvent.click(result(dialog, "Other"));
  searchFor(dialog, "Single items");
  fireEvent.click(
    await within(dialog).findByRole("checkbox", { name: /^Alpha / }),
  );
  const rows = () =>
    within(
      within(dialog).getByRole("list", { name: "In this show" }),
    ).getAllByRole("listitem");
  expect(rows().map((row) => row.firstChild?.textContent)).toEqual([
    "Favorites",
    "Other",
    "Alpha",
  ]);
  fireEvent.click(
    within(rows()[1]).getByRole("button", { name: "Move member up" }),
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));

  await waitFor(() => expect(patches(api)).toHaveLength(1));
  expect(patches(api)[0]?.body).toMatchObject({
    members: [
      { kind: "collection", mediaCollectionId: "other" },
      { kind: "collection", mediaCollectionId: "favorites" },
      { kind: "media_item", mediaItemId: "z" },
    ],
  });
});

it("words presets in programs for a show of mixed or unclassified content", async () => {
  await openLineup(
    [
      favoritesAssignment("chronological", {
        members: [{ kind: "collection", mediaCollectionId: "mixed" }],
      }),
    ],
    [collectionWith("mixed", "Mixed")],
    serveSuggestions,
  );

  await screen.findByRole("cell", { name: "3 programs" });
  const dialog = await openProperties("Mixed");
  await waitFor(() =>
    expect(
      within(perSitting(dialog))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      "Choose…",
      "1 program",
      "3 programs",
      "~30 min",
      "~1 hr",
      "~2 hrs",
      "Custom…",
    ]),
  );
  expect(chosenOption(perSitting(dialog))).toBe("3 programs");
});

it("shows a single-item show without order, per sitting, or marathons", async () => {
  await openLineup(
    [
      {
        id: "alpha",
        name: null,
        participation: "default",
        playbackMode: null,
        ordinaryStretch: { kind: "programs", count: 1 },
        marathonStretch: null,
        members: [{ kind: "media_item", mediaItemId: "z" }],
      },
    ],
    [],
    (api) => api.reply("/media-items/z", adminFixtures.media[0]),
  );

  const dialog = await openProperties("Alpha");

  within(dialog).getByText(
    "A single item plays once each time this show comes up.",
  );
  expect(within(dialog).queryByLabelText("Play order")).toBeNull();
  expect(within(dialog).queryByLabelText("Plays at a time")).toBeNull();
  expect(within(dialog).queryByLabelText("Allow marathons")).toBeNull();
});

it("opens the Custom dialog from Custom… while a preset is saved", async () => {
  const { api } = await openLineup([marathonShow], [], (api) =>
    serveSettings(api, {
      marathonChancePercent: 10,
      marathonMinOrdinaryRounds: 2,
    }),
  );
  await waitFor(() =>
    expect(chosenOption(marathonsSelect())).toBe("Occasional"),
  );
  expect(
    screen.queryByRole("button", { name: "Edit custom marathons" }),
  ).toBeNull();

  chooseOption(marathonsSelect(), "Custom…");

  screen.getByRole("dialog", { name: "Custom marathons" });
  expect(settingsWrites(api)).toEqual([]);
});

it("names the show the server's validation refused, from the picks as they were sent", async () => {
  const { api } = await openLineup(
    [],
    [collectionWith("movies", "Movies")],
    serveSuggestions,
  );
  api.reply(
    BATCH,
    {
      error: {
        code: "invalid_request",
        message: "✖ Invalid input\n  → at assignments[1].ordinaryStretch",
      },
    },
    "POST",
    400,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Add shows…" }));
  const dialog = screen.getByRole("dialog", { name: "Add shows" });
  fireEvent.click(result(dialog, "Favorites"));
  fireEvent.click(result(dialog, "Movies"));
  next(dialog, 2);
  const add = within(dialog).getByRole<HTMLButtonElement>("button", {
    name: "Add (2)",
  });
  await waitFor(() => expect(add.disabled).toBe(false));
  fireEvent.click(add);
  await within(dialog).findByText(/Movies could not be added/);

  // Changing the picks afterward never renames the refused show.
  back(dialog);
  fireEvent.click(result(dialog, "Favorites"));

  expect(within(dialog).getByRole("alert").textContent).toMatch(
    /Movies could not be added/,
  );
});

it("asks for per sitting when a pick's content cannot be checked", async () => {
  const { api } = await openLineup([], [], (api) =>
    api.reply(
      "/programming-assignments/stretch-suggestion",
      { error: { code: "offline", message: "Down" } },
      "GET",
      503,
    ),
  );
  api.reply("/media-items", { items: [], total: 0 });
  fireEvent.click(await screen.findByRole("button", { name: "Add shows…" }));
  const dialog = screen.getByRole("dialog", { name: "Add shows" });

  fireEvent.click(result(dialog, "Favorites"));
  next(dialog, 1);

  const choice =
    await within(dialog).findByLabelText<HTMLSelectElement>("Plays at a time");
  chooseOption(choice, "3 programs");
  expect(
    within(dialog).getByRole<HTMLButtonElement>("button", { name: "Add (1)" })
      .disabled,
  ).toBe(false);
});

it("adds picks as one named wheel whose members share its turns, badged Wheel in the lineup", async () => {
  const { api } = await openLineup(
    [],
    [collectionWith("movies", "Movies")],
    serveSuggestions,
  );
  api.handle(
    BATCH,
    (request) => {
      const { assignments } = request.body as { assignments: object[] };
      api.reply(
        ASSIGNMENTS,
        assignments.map((settings) => ({ ...settings, id: "together" })),
      );
      return api.response([], 201);
    },
    "POST",
  );
  fireEvent.click(await screen.findByRole("button", { name: "Add shows…" }));
  const dialog = screen.getByRole("dialog", { name: "Add shows" });
  fireEvent.click(result(dialog, "Favorites"));
  searchFor(dialog, "Single items");
  fireEvent.click(
    await within(dialog).findByRole("checkbox", { name: /^Alpha / }),
  );
  expect(within(dialog).queryByLabelText("Wheel name")).toBeNull();

  fireEvent.click(within(dialog).getByRole("radio", { name: "A wheel" }));
  const name = within(dialog).getByLabelText<HTMLInputElement>("Wheel name");
  expect(name.placeholder).toBe("Favorites + Alpha");
  fireEvent.change(name, { target: { value: " Adult Animation " } });
  next(dialog, 2);
  const add = within(dialog).getByRole<HTMLButtonElement>("button", {
    name: "Add wheel (2)",
  });
  await waitFor(() => expect(add.disabled).toBe(false));
  fireEvent.click(add);

  const row = (
    await screen.findByRole("button", { name: "Adult Animation" })
  ).closest("tr");
  expect(row?.textContent).toMatch(/Wheel/);
  expect(api.requestsTo(BATCH).map((request) => request.body)).toEqual([
    {
      assignments: [
        {
          name: "Adult Animation",
          participation: "default",
          playbackMode: "chronological",
          ordinaryStretch: { kind: "programs", count: 3 },
          marathonStretch: null,
          members: [
            { kind: "collection", mediaCollectionId: "favorites" },
            { kind: "media_item", mediaItemId: "z" },
          ],
        },
      ],
    },
  ]);
});

it("names a refused wheel by its name", async () => {
  const { api } = await openLineup(
    [],
    [collectionWith("movies", "Movies")],
    serveSuggestions,
  );
  api.reply(
    BATCH,
    { error: { code: "media_item_not_found", message: "Gone", index: 0 } },
    "POST",
    400,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Add shows…" }));
  const dialog = screen.getByRole("dialog", { name: "Add shows" });
  fireEvent.click(within(dialog).getByRole("radio", { name: "A wheel" }));
  fireEvent.click(result(dialog, "Favorites"));
  fireEvent.click(result(dialog, "Movies"));
  fireEvent.change(within(dialog).getByLabelText("Wheel name"), {
    target: { value: "Weekend" },
  });
  next(dialog, 2);
  const add = within(dialog).getByRole<HTMLButtonElement>("button", {
    name: "Add wheel (2)",
  });
  await waitFor(() => expect(add.disabled).toBe(false));
  fireEvent.click(add);

  expect((await within(dialog).findByRole("alert")).textContent).toMatch(
    /Weekend could not be added: Gone/,
  );
});

it("lists a named show by its name, and renames it or clears the name from Properties", async () => {
  const named = favoritesAssignment("chronological", {
    name: "Adult Animation",
  });
  const { api } = await openLineup([named]);
  let saved = named;
  savesAs(api, () => saved);
  const dialog = await openProperties("Adult Animation");
  const name = within(dialog).getByLabelText<HTMLInputElement>("Name");
  expect(name.value).toBe("Adult Animation");
  expect(name.placeholder).toBe("Favorites");

  saved = { ...named, name: "Cartoons" };
  fireEvent.change(name, { target: { value: "Cartoons" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
  await screen.findByRole("button", { name: "Cartoons" });
  saved = { ...named, name: null };
  fireEvent.change(name, { target: { value: "  " } });
  fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));

  await screen.findByRole("button", { name: "Favorites" });
  expect(patches(api).map((request) => request.body)).toMatchObject([
    { name: "Cartoons" },
    { name: null },
  ]);
  // A new name changes nothing that airs, so no rebuild is offered.
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
