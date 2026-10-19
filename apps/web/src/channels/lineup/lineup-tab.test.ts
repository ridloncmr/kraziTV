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
import { ChannelsApp } from "../channels-app.js";

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

// Opens a dialog's collapsed Advanced section.
function openAdvanced(dialog: HTMLElement) {
  const details = within(dialog).getByText("Advanced").closest("details");
  if (details) details.open = true;
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

const countBox = (dialog: HTMLElement) =>
  within(dialog).getByLabelText<HTMLInputElement>("Programs per turn");
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
      ["The Office + Parks + 1 more", "Random", "3 programs", "—", ""],
      ["Alpha", "—", "1 program", "—", "Rules only"],
    ]),
  );
  expect(screen.queryByRole("button", { name: /Move/ })).toBeNull();
  expect(screen.queryByRole("group", { name: /Assignment/ })).toBeNull();
  expect(api.requestsTo(`${ASSIGNMENTS}/order`)).toEqual([]);
});

it.each([
  ["episode", /Plays by series, season, and episode/],
  ["release", /Plays by release or air date/],
] as const)(
  "saves %s order from Properties, explains it, and shows it when reopened",
  async (playbackMode, hint) => {
    const { api } = await openLineup([favoritesAssignment("chronological")]);
    savesAs(api, () => favoritesAssignment(playbackMode));
    const dialog = await openProperties();
    const order = within(dialog).getByLabelText<HTMLSelectElement>("Order");
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
      participation: "default",
      playbackMode,
      ordinaryStretch: { kind: "programs", count: 3 },
      marathonStretch: null,
      members: [{ kind: "collection", mediaCollectionId: "favorites" }],
    });
    await waitFor(() => expect(api.readAfterLastWrite(ASSIGNMENTS)).toBe(true));
    const reopened = await openProperties();
    expect(
      within(reopened).getByLabelText<HTMLSelectElement>("Order").value,
    ).toBe(playbackMode);
  },
);

it("keeps an unsaved order across minimize and restore", async () => {
  const { api, view } = await openLineup([
    favoritesAssignment("chronological"),
  ]);
  const dialog = await openProperties();
  fireEvent.change(within(dialog).getByLabelText("Order"), {
    target: { value: "random" },
  });

  view.rerender(createElement(ChannelsApp, { visible: false }));
  view.rerender(createElement(ChannelsApp, { visible: true }));

  await waitFor(() => expect(api.requestsTo(ASSIGNMENTS)).toHaveLength(2));
  expect(
    within(
      screen.getByRole("dialog", { name: "Favorites" }),
    ).getByLabelText<HTMLSelectElement>("Order").value,
  ).toBe("random");
});

it("discards every change on Cancel, so reopening shows the saved settings", async () => {
  const { api } = await openLineup([favoritesAssignment("chronological")]);
  const dialog = await openProperties();
  fireEvent.change(countBox(dialog), { target: { value: "2" } });
  openAdvanced(dialog);
  fireEvent.click(within(dialog).getByLabelText("Plays in normal rotation"));

  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

  expect(screen.queryByRole("dialog")).toBeNull();
  const reopened = await openProperties();
  expect(countBox(reopened).value).toBe("3");
  expect(
    within(reopened).getByLabelText<HTMLInputElement>(
      "Plays in normal rotation",
    ).checked,
  ).toBe(true);
  expect(patches(api)).toEqual([]);
});

it("saves on Apply and stays open, then saves on OK and closes", async () => {
  const { api } = await openLineup([favoritesAssignment("chronological")]);
  let count = 3;
  savesAs(api, () =>
    favoritesAssignment("chronological", {
      ordinaryStretch: { kind: "programs", count },
    }),
  );
  const dialog = await openProperties();

  fireEvent.change(countBox(dialog), { target: { value: "2" } });
  count = 2;
  fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
  await waitFor(() => expect(api.readAfterLastWrite(ASSIGNMENTS)).toBe(true));
  expect(screen.getByRole("dialog", { name: "Favorites" })).toBe(dialog);
  await screen.findByRole("cell", { name: "2 programs" });

  fireEvent.change(countBox(dialog), { target: { value: "4" } });
  count = 4;
  fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(patches(api).map((request) => request.body)).toEqual([
    expect.objectContaining({
      ordinaryStretch: { kind: "programs", count: 2 },
    }),
    expect.objectContaining({
      ordinaryStretch: { kind: "programs", count: 4 },
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
});

it("derives the marathon length from per sitting once the show can marathon", async () => {
  const { api } = await openLineup([favoritesAssignment("chronological")]);
  const dialog = await openProperties();

  fireEvent.click(within(dialog).getByLabelText("Can marathon"));
  within(dialog).getByText("up to 6 programs");
  fireEvent.change(countBox(dialog), { target: { value: "4" } });
  within(dialog).getByText("up to 8 programs");
  fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));

  await waitFor(() => expect(patches(api)).toHaveLength(1));
  expect(patches(api)[0]?.body).toMatchObject({
    ordinaryStretch: { kind: "programs", count: 4 },
    marathonStretch: { kind: "programs", count: 8 },
  });
});

it("keeps a saved marathon length override under Advanced, and returns to the derived length when it is cleared", async () => {
  const { api } = await openLineup([
    favoritesAssignment("chronological", {
      marathonStretch: { kind: "airtime", minutes: 240 },
    }),
  ]);
  const dialog = await openProperties();
  within(dialog).getByText("up to 4 hrs");
  openAdvanced(dialog);
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
  within(dialog).getByText("up to 6 programs");
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

it("adds, reorders, and saves a show's members under Advanced", async () => {
  const { api } = await openLineup(
    [favoritesAssignment("chronological")],
    [collectionWith("other", "Other")],
  );
  const dialog = await openProperties();
  openAdvanced(dialog);
  within(dialog).getByText(/Add separate shows for separate turns/);

  fireEvent.click(within(dialog).getByRole("button", { name: "Add member" }));
  const rows = () =>
    within(within(dialog).getByRole("list", { name: "Members" })).getAllByRole(
      "listitem",
    );
  fireEvent.change(within(rows()[1]).getByLabelText("Programming source"), {
    target: { value: "other" },
  });
  fireEvent.click(
    within(rows()[1]).getByRole("button", { name: "Move member up" }),
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));

  await waitFor(() => expect(patches(api)).toHaveLength(1));
  expect(patches(api)[0]?.body).toMatchObject({
    members: [
      { kind: "collection", mediaCollectionId: "other" },
      { kind: "collection", mediaCollectionId: "favorites" },
    ],
  });
});

it("saves a show kept out of normal rotation and lists it as Rules only", async () => {
  const { api } = await openLineup([favoritesAssignment("chronological")]);
  savesAs(api, () =>
    favoritesAssignment("chronological", { participation: "rule_only" }),
  );
  const dialog = await openProperties();
  openAdvanced(dialog);

  fireEvent.click(within(dialog).getByLabelText("Plays in normal rotation"));
  within(dialog).getByText("Airs only while a programming rule selects it.");
  fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));

  await screen.findByText("Rules only");
  expect(patches(api)[0]?.body).toMatchObject({ participation: "rule_only" });
  const reopened = await openProperties();
  expect(
    within(reopened).getByLabelText<HTMLInputElement>(
      "Plays in normal rotation",
    ).checked,
  ).toBe(false);
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
  openAdvanced(dialog);
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

  fireEvent.change(within(dialog).getByLabelText("Order"), {
    target: { value: "episode" },
  });
  await waitFor(async () =>
    expect(await playOrder()).toEqual([
      expect.stringContaining("The Office: Pilot"),
      expect.stringContaining("Diversity Day"),
    ]),
  );
  within(dialog).getByText("Save this mode to see its upcoming selections.");

  fireEvent.change(within(dialog).getByLabelText("Order"), {
    target: { value: "random" },
  });
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
  openAdvanced(properties);
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

it("adds a single item as a new show with no order or per sitting", async () => {
  const { api } = await openLineup([]);
  api.reply("/media-items", { items: adminFixtures.media, total: 2 });
  api.reply(ASSIGNMENTS, {}, "POST", 201);
  fireEvent.click(await screen.findByRole("button", { name: "New show…" }));
  const dialog = screen.getByRole("dialog", { name: "New show" });

  fireEvent.change(within(dialog).getByLabelText("Source type"), {
    target: { value: "media_item" },
  });
  await within(dialog).findByRole("option", { name: "Alpha (available)" });
  fireEvent.change(within(dialog).getByLabelText("Programming source"), {
    target: { value: "z" },
  });
  expect(within(dialog).queryByLabelText("Order")).toBeNull();
  expect(within(dialog).queryByLabelText("Programs per turn")).toBeNull();
  expect(within(dialog).queryByRole("button", { name: "Apply" })).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(
    api.requests.find((request) => request.method === "POST")?.body,
  ).toEqual({
    participation: "default",
    playbackMode: null,
    ordinaryStretch: { kind: "programs", count: 1 },
    marathonStretch: null,
    members: [{ kind: "media_item", mediaItemId: "z" }],
  });
});

it("adds a new show with the suggested per sitting and lists it after the first", async () => {
  const { api } = await openLineup(
    [favoritesAssignment("chronological")],
    [collectionWith("other", "Other")],
  );
  api.reply("/programming-assignments/stretch-suggestion", {
    ordinaryStretch: { kind: "programs", count: 3 },
    contentKind: "episodes",
  });
  api.handle(
    ASSIGNMENTS,
    () => {
      api.reply(ASSIGNMENTS, [
        favoritesAssignment("chronological"),
        favoritesAssignment("random", {
          id: "second",
          members: [{ kind: "collection", mediaCollectionId: "other" }],
        }),
      ]);
      return api.response({}, 201);
    },
    "POST",
  );
  fireEvent.click(await screen.findByRole("button", { name: "New show…" }));
  const dialog = screen.getByRole("dialog", { name: "New show" });

  fireEvent.change(within(dialog).getByLabelText("Programming source"), {
    target: { value: "other" },
  });
  // The server suggests three programs per sitting for this collection.
  await waitFor(() => expect(countBox(dialog).value).toBe("3"));
  fireEvent.change(within(dialog).getByLabelText("Order"), {
    target: { value: "random" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));

  await screen.findByRole("button", { name: "Other" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(
    api.requests.find((request) => request.method === "POST")?.body,
  ).toEqual({
    participation: "default",
    playbackMode: "random",
    ordinaryStretch: { kind: "programs", count: 3 },
    marathonStretch: null,
    members: [{ kind: "collection", mediaCollectionId: "other" }],
  });
});

it("asks for per sitting when the server has no suggestion, then saves an airtime range", async () => {
  const { api } = await openLineup([]);
  api.reply("/programming-assignments/stretch-suggestion", {
    ordinaryStretch: null,
    contentKind: null,
  });
  api.reply(ASSIGNMENTS, {}, "POST", 201);
  fireEvent.click(await screen.findByRole("button", { name: "New show…" }));
  const dialog = screen.getByRole("dialog", { name: "New show" });

  fireEvent.change(within(dialog).getByLabelText("Programming source"), {
    target: { value: "favorites" },
  });

  await within(dialog).findByText(/Choose how much airs per sitting/);
  expect(
    api
      .requestsTo("/programming-assignments/stretch-suggestion")
      .map((request) => request.query.get("mediaCollectionIds")),
  ).toContain("favorites");
  expect(countBox(dialog).value).toBe("");
  fireEvent.change(within(dialog).getByLabelText("Turn length"), {
    target: { value: "airtime_range" },
  });
  expect(within(dialog).getByText(/runs over/).textContent).toMatch(
    /picks one target/,
  );
  fireEvent.change(within(dialog).getByLabelText("At least minutes"), {
    target: { value: "60" },
  });
  fireEvent.change(within(dialog).getByLabelText("At most minutes"), {
    target: { value: "120" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));

  await waitFor(() => expect(api.readAfterLastWrite(ASSIGNMENTS)).toBe(true));
  expect(
    api.requests.find((request) => request.method === "POST")?.body,
  ).toEqual({
    participation: "default",
    playbackMode: "chronological",
    ordinaryStretch: { kind: "airtime_range", minMinutes: 60, maxMinutes: 120 },
    marathonStretch: null,
    members: [{ kind: "collection", mediaCollectionId: "favorites" }],
  });
});

it("keeps a derived marathon longer than per sitting suggested afterwards", async () => {
  const { api } = await openLineup([]);
  api.reply("/programming-assignments/stretch-suggestion", {
    ordinaryStretch: { kind: "programs", count: 3 },
    contentKind: "episodes",
  });
  fireEvent.click(await screen.findByRole("button", { name: "New show…" }));
  const dialog = screen.getByRole("dialog", { name: "New show" });

  fireEvent.click(within(dialog).getByLabelText("Can marathon"));
  fireEvent.change(within(dialog).getByLabelText("Programming source"), {
    target: { value: "favorites" },
  });

  await within(dialog).findByText("up to 6 programs");
  expect(countBox(dialog).value).toBe("3");
});

it("saves the suggested marathon chance and cooldown once a show can marathon", async () => {
  const { api } = await openLineup(
    [
      favoritesAssignment("chronological", {
        marathonStretch: { kind: "programs", count: 6 },
      }),
    ],
    [],
    (api) => {
      api.reply("/channels/one/programming-settings", {
        marathonChancePercent: 0,
        marathonMinOrdinaryRounds: 2,
      });
      api.reply(
        "/channels/one/programming-settings",
        { marathonChancePercent: 10, marathonMinOrdinaryRounds: 2 },
        "PUT",
      );
    },
  );
  const marathons = await screen.findByRole("group", { name: "Marathons" });

  fireEvent.click(
    await within(marathons).findByRole("button", {
      name: "Use the suggested 10% and two rounds",
    }),
  );
  fireEvent.click(
    within(marathons).getByRole("button", { name: "Save marathon settings" }),
  );

  await waitFor(() => expect(api.readAfterLastWrite(ASSIGNMENTS)).toBe(true));
  expect(
    api.requests.find((request) => request.method === "PUT")?.body,
  ).toEqual({ marathonChancePercent: 10, marathonMinOrdinaryRounds: 2 });
});
