// @vitest-environment jsdom
import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BrowserApi } from "../testing/browser-api.js";
import { adminFixtures, collectionWith } from "../testing/admin-fixtures.js";
import {
  catalogFranchises,
  catalogSeries,
  officeCollection,
  serveCollection,
} from "../testing/collection-api.js";
import { CollectionsApp } from "./collections-app.js";
import { clickWhenEnabled } from "../testing/click-when-enabled.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const collections = [
  ...adminFixtures.collections,
  collectionWith("cartoons", "Cartoons", { memberCount: 1 }),
];

// Serves two collections, favorites holding both fixture media, and renders the program.
function renderApp(onOpenChannels?: () => void) {
  const api = new BrowserApi();
  api.reply("/media-collections", collections);
  serveCollection(api, "favorites", ["z", "a"]);
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(CollectionsApp, { visible: true, onOpenChannels }));
  return api;
}

function disabled(name: string) {
  return screen.getByRole("button", { name }).matches(":disabled");
}

// Opens a collection's card from the Manual grid once the list has loaded.
async function open(name: string) {
  fireEvent.click(await screen.findByRole("button", { name: `Open ${name}` }));
  await screen.findByRole("heading", { name });
}

it("lists manual collections as cards with their member counts and opens one for editing", async () => {
  renderApp();

  const manual = await screen.findByRole("tab", { name: "Manual" });
  expect(manual.getAttribute("aria-selected")).toBe("true");
  const grid = screen.getByRole("tabpanel", { name: "Manual" });
  expect(
    within(grid)
      .getAllByRole("button", { name: /^Open / })
      .map((card) => card.textContent),
  ).toEqual([
    "Favorites2 items1 missing — won't air until its file returns",
    "Cartoons1 item",
  ]);

  // The count is announced with the card, not only shown.
  expect(
    screen.getByRole("button", {
      name: "Open Cartoons",
      description: "1 item",
    }),
  ).toBeTruthy();
  await open("Favorites");

  expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe(
    "Favorites",
  );
  expect(screen.queryByRole("tablist")).toBeNull();
});

it("shows an empty Automatic tab without listing manual collections there", async () => {
  renderApp();

  fireEvent.click(await screen.findByRole("tab", { name: "Automatic" }));

  const grid = screen.getByRole("tabpanel", { name: "Automatic" });
  expect(within(grid).queryByRole("button", { name: /^Open / })).toBeNull();
  expect(within(grid).getByText(/No automatic collections yet/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "New collection…" })).toBeNull();
});

it("blocks leaving an unsaved draft until it is saved or discarded", async () => {
  renderApp();
  await open("Favorites");
  fireEvent.click(await screen.findByLabelText("Select member Zulu"));
  fireEvent.click(screen.getByRole("button", { name: "Move to top" }));

  expect(disabled("All collections")).toBe(true);
  expect(
    screen.getByText("Save or discard changes before leaving this collection."),
  ).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  await waitFor(() => expect(disabled("All collections")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "All collections" }));
  await screen.findByRole("tab", { name: "Manual" });
});

it("deletes a collection only after confirmation and returns to the grid", async () => {
  const api = renderApp();
  api.reply("/media-collections/favorites", null, "DELETE", 204);
  await open("Favorites");
  fireEvent.click(
    await screen.findByRole("button", { name: "Delete collection" }),
  );
  expect(api.requests.some((request) => request.method === "DELETE")).toBe(
    false,
  );

  fireEvent.click(
    screen.getByRole("button", { name: "Delete collection permanently" }),
  );

  await screen.findByRole("tab", { name: "Manual" });
  expect(
    api.requests.find((request) => request.method === "DELETE")?.path,
  ).toBe("/media-collections/favorites");
});

it("creates a collection in a dialog and opens it for editing", async () => {
  const api = renderApp();
  // The create response carries no member count; only the listing does.
  api.reply(
    "/media-collections",
    { id: "news", name: "News", maintenanceMode: "manual" },
    "POST",
  );
  serveCollection(api, "news", []);
  fireEvent.click(
    await screen.findByRole("button", { name: "New collection…" }),
  );
  fireEvent.change(screen.getByLabelText("Collection name"), {
    target: { value: "News" },
  });
  api.reply("/media-collections", [
    ...collections,
    collectionWith("news", "News"),
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Create collection" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await screen.findByRole("heading", { name: "News" });
  expect(
    api.requests.find((request) => request.method === "POST")?.body,
  ).toEqual({ name: "News" });
});

it("reports a rejected delete inside its confirmation", async () => {
  const api = renderApp();
  api.reply(
    "/media-collections/favorites",
    {
      error: {
        code: "collection_in_use",
        message: "A channel programs from this collection",
      },
    },
    "DELETE",
    409,
  );
  await open("Favorites");
  fireEvent.click(
    await screen.findByRole("button", { name: "Delete collection" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Delete collection permanently" }),
  );

  expect(
    (
      await screen.findByText("A channel programs from this collection")
    ).closest('[role="dialog"]'),
  ).toBe(screen.getByRole("dialog", { name: "Delete collection" }));
});

it("names the special a refused delete waits on and opens My Channels to change it", async () => {
  const openChannels = vi.fn();
  const api = renderApp(openChannels);
  api.reply("/channels", adminFixtures.channels);
  api.reply(
    "/media-collections/favorites",
    {
      error: {
        code: "media_collection_in_use",
        message: "Media collection favorites is played by reservations",
        channelIds: ["one"],
        reservations: [
          {
            id: "special-1",
            channelId: "one",
            startsAt: "2026-10-31T00:00:00.000Z",
          },
        ],
      },
    },
    "DELETE",
    409,
  );
  await open("Favorites");
  fireEvent.click(
    await screen.findByRole("button", { name: "Delete collection" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Delete collection permanently" }),
  );

  const blocking = await screen.findByLabelText("Blocking specials");
  await within(blocking).findByText(/Channel 69 · special at/);
  fireEvent.click(
    within(blocking).getByRole("button", { name: "Open My Channels" }),
  );
  expect(openChannels).toHaveBeenCalledOnce();
});

it("marks an automatic card kept incomplete by expired TMDB data", async () => {
  const api = renderApp();
  api.reply("/media-collections", [
    { ...officeCollection, maintenanceIncomplete: true },
  ]);
  fireEvent.click(await screen.findByRole("button", { name: "Refresh" }));
  fireEvent.click(await screen.findByRole("tab", { name: "Automatic" }));

  const card = await screen.findByRole("button", { name: "Open The Office" });

  expect(card.textContent).toMatch(
    /Incomplete — expired TMDB data kept members unchanged/,
  );
});

it("marks an automatic card whose latest maintenance failed", async () => {
  const api = renderApp();
  api.reply("/media-collections", [
    { ...officeCollection, maintenanceError: "disk I/O error" },
  ]);
  fireEvent.click(await screen.findByRole("button", { name: "Refresh" }));
  fireEvent.click(await screen.findByRole("tab", { name: "Automatic" }));

  const card = await screen.findByRole("button", { name: "Open The Office" });

  expect(card.textContent).toMatch(
    /Update failed — members may be out of date/,
  );
});

it("previews a movie franchise and creates its automatic collection", async () => {
  const api = renderApp();
  api.reply("/media-collections/series", catalogSeries);
  api.reply("/media-collections/franchises", catalogFranchises);
  api.reply(
    "/media-collections/previews",
    [
      {
        position: 0,
        mediaItemId: "z",
        title: "Alpha",
        path: "/media/alpha.mp4",
        status: "available",
        durationMs: 1_200_000,
      },
    ],
    "POST",
  );
  api.reply(
    "/media-collections",
    {
      id: "indy",
      name: "Indiana Jones Collection",
      maintenanceMode: "automatic",
      criterion: { kind: "franchise", tmdbId: 84 },
      criterionLabel: "Indiana Jones Collection",
      maintainedAt: "2026-10-13T12:00:00.000Z",
      maintenanceError: null,
    },
    "POST",
  );
  fireEvent.click(await screen.findByRole("tab", { name: "Automatic" }));
  fireEvent.click(
    screen.getByRole("button", { name: "New automatic collection…" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "New automatic collection",
  });

  fireEvent.click(
    within(dialog).getByRole("radio", { name: "Movie franchise" }),
  );
  await within(dialog).findByRole("option", {
    name: /^Indiana Jones Collection/,
  });
  fireEvent.change(within(dialog).getByLabelText("Franchise"), {
    target: { value: "84" },
  });
  await within(dialog).findByText("1 movie in this order");
  await clickWhenEnabled(
    within(dialog).getByRole("button", { name: "Create automatic collection" }),
  );

  await waitFor(() =>
    expect(
      api.requests.find(
        (request) =>
          request.method === "POST" && request.path === "/media-collections",
      )?.body,
    ).toEqual({
      name: "Indiana Jones Collection",
      criterion: { kind: "franchise", tmdbId: 84 },
    }),
  );
});

it("previews a series and creates an automatic collection listed under Automatic", async () => {
  const api = renderApp();
  api.reply("/media-collections/series", catalogSeries);
  api.reply(
    "/media-collections/previews",
    [
      {
        position: 0,
        mediaItemId: "e2",
        title: "Episode 2",
        path: "/tv/show/episode 2.mkv",
        status: "available",
        durationMs: 1_400_000,
      },
      {
        position: 1,
        mediaItemId: "e10",
        title: "Episode 10",
        path: "/tv/show/episode 10.mkv",
        status: "missing",
        durationMs: 1_500_000,
      },
    ],
    "POST",
  );
  const { memberCount: _, missingCount: __, ...created } = officeCollection;
  api.reply("/media-collections", created, "POST");
  serveCollection(api, "office", ["e2", "e10"]);
  fireEvent.click(await screen.findByRole("tab", { name: "Automatic" }));
  fireEvent.click(
    screen.getByRole("button", { name: "New automatic collection…" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "New automatic collection",
  });
  expect(
    within(dialog)
      .getByRole("button", { name: "Create automatic collection" })
      .matches(":disabled"),
  ).toBe(true);

  await within(dialog).findByRole("option", { name: /^The Office/ });
  fireEvent.change(within(dialog).getByLabelText("Series"), {
    target: { value: "2316" },
  });

  await within(dialog).findByText("Episode 10");
  expect(
    within(dialog).getByLabelText<HTMLInputElement>("Collection name").value,
  ).toBe("The Office");
  expect(within(dialog).getByText("2 episodes in this order")).toBeTruthy();
  expect(api.requestsTo("/media-collections/previews").at(-1)?.body).toEqual({
    criterion: { kind: "series", tmdbId: 2316 },
  });
  api.reply("/media-collections", [...collections, officeCollection]);
  await clickWhenEnabled(
    within(dialog).getByRole("button", { name: "Create automatic collection" }),
  );

  await screen.findByRole("heading", { name: "The Office" });
  expect(
    api.requests.find(
      (request) =>
        request.method === "POST" && request.path === "/media-collections",
    )?.body,
  ).toEqual({
    name: "The Office",
    criterion: { kind: "series", tmdbId: 2316 },
  });
  fireEvent.click(screen.getByRole("button", { name: "All collections" }));
  const grid = await screen.findByRole("tabpanel", { name: "Automatic" });
  expect(
    within(grid).getByRole("button", { name: "Open The Office" }).textContent,
  ).toBe("The OfficeTV series: The Office2 itemsUp to date");
});

it("creates an automatic collection from a tag in use", async () => {
  const api = renderApp();
  api.reply("/media-collections/series", catalogSeries);
  api.reply("/media-collections/tags", [
    { tagId: "tag-christmas", name: "Christmas", itemCount: 1 },
  ]);
  api.reply(
    "/media-collections/previews",
    [
      {
        position: 0,
        mediaItemId: "z",
        title: "Alpha",
        path: "/media/alpha.mp4",
        status: "available",
        durationMs: 1_200_000,
      },
    ],
    "POST",
  );
  api.reply(
    "/media-collections",
    {
      id: "christmas",
      name: "Christmas",
      maintenanceMode: "automatic",
      criterion: { kind: "tag", tagId: "tag-christmas" },
      criterionLabel: "Christmas",
      maintainedAt: "2026-10-13T12:00:00.000Z",
      maintenanceError: null,
      maintenanceIncomplete: false,
    },
    "POST",
  );
  fireEvent.click(await screen.findByRole("tab", { name: "Automatic" }));
  fireEvent.click(
    screen.getByRole("button", { name: "New automatic collection…" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "New automatic collection",
  });

  fireEvent.click(within(dialog).getByRole("radio", { name: "Tag" }));
  await within(dialog).findByRole("option", { name: "Christmas (1 item)" });
  fireEvent.change(within(dialog).getByLabelText("Tag name"), {
    target: { value: "tag-christmas" },
  });
  await within(dialog).findByText("1 item in this order");
  await clickWhenEnabled(
    within(dialog).getByRole("button", { name: "Create automatic collection" }),
  );

  await waitFor(() =>
    expect(
      api.requests.find(
        (request) =>
          request.method === "POST" && request.path === "/media-collections",
      )?.body,
    ).toEqual({
      name: "Christmas",
      criterion: { kind: "tag", tagId: "tag-christmas" },
    }),
  );
});

it("creates an automatic collection from a standard genre", async () => {
  const api = renderApp();
  api.reply("/media-collections/series", catalogSeries);
  api.reply("/media-collections/genres", [{ name: "Action", itemCount: 2 }]);
  api.reply(
    "/media-collections/previews",
    [
      {
        position: 0,
        mediaItemId: "z",
        title: "Alpha",
        path: "/media/alpha.mp4",
        status: "available",
        durationMs: 1_200_000,
      },
    ],
    "POST",
  );
  api.reply(
    "/media-collections",
    {
      id: "action",
      name: "Action",
      maintenanceMode: "automatic",
      criterion: { kind: "genre", name: "Action" },
      criterionLabel: "Action",
      maintainedAt: "2026-10-13T12:00:00.000Z",
      maintenanceError: null,
      maintenanceIncomplete: false,
    },
    "POST",
  );
  fireEvent.click(await screen.findByRole("tab", { name: "Automatic" }));
  fireEvent.click(
    screen.getByRole("button", { name: "New automatic collection…" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "New automatic collection",
  });

  fireEvent.click(within(dialog).getByRole("radio", { name: "Genre" }));
  await within(dialog).findByRole("option", { name: "Action (2 items)" });
  fireEvent.change(within(dialog).getByLabelText("Genre name"), {
    target: { value: "Action" },
  });
  await within(dialog).findByText("1 item in this order");
  await clickWhenEnabled(
    within(dialog).getByRole("button", { name: "Create automatic collection" }),
  );

  await waitFor(() =>
    expect(
      api.requests.find(
        (request) =>
          request.method === "POST" && request.path === "/media-collections",
      )?.body,
    ).toEqual({ name: "Action", criterion: { kind: "genre", name: "Action" } }),
  );
});

const officeRecommendation = {
  criterion: { kind: "series", tmdbId: 2316 },
  name: "The Office",
  reason: "2 cataloged episodes of the TV series The Office",
  memberCount: 2,
  members: [
    {
      position: 0,
      mediaItemId: "e2",
      title: "Episode 2",
      path: "/tv/show/episode 2.mkv",
      status: "available",
      durationMs: 1_400_000,
    },
    {
      position: 1,
      mediaItemId: "e10",
      title: "Episode 10",
      path: "/tv/show/episode 10.mkv",
      status: "available",
      durationMs: 1_500_000,
    },
  ],
  seasonCount: 1,
  collectionId: null,
  decision: null,
};

it("discovers recommendations with reason and count, never listing them as collections before acceptance", async () => {
  const api = renderApp();
  const recommendations = "/media-collections/recommendations";
  api.reply(recommendations, [officeRecommendation]);
  api.reply(`${recommendations}/dismissal`, null, "POST", 204);
  const { memberCount: _, missingCount: __, ...created } = officeCollection;
  api.reply(`${recommendations}/acceptance`, created, "POST", 201);
  fireEvent.click(await screen.findByRole("tab", { name: "Automatic" }));

  fireEvent.click(
    screen.getByRole("button", { name: "Discover collections…" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Discover collections",
  });

  const card = (await within(dialog).findByText("The Office")).closest("li")!;
  expect(
    within(card).getByText("2 cataloged episodes of the TV series The Office"),
  ).toBeTruthy();
  expect(within(card).getByText("2 items, 1 season")).toBeTruthy();
  expect(
    within(dialog).getByText(/An automatic collection keeps itself up to date/),
  ).toBeTruthy();
  expect(
    within(screen.getByRole("tabpanel", { name: "Automatic" })).queryByRole(
      "button",
      { name: /^Open / },
    ),
  ).toBeNull();

  api.reply("/media-collections", [...collections, officeCollection]);
  fireEvent.click(
    within(card).getByRole("button", {
      name: "Create automatic collection from The Office",
    }),
  );

  // The dialog stays open so another can be created; the created one leaves
  // the list at once, even before a reread drops it, and appears behind it
  // on the Automatic tab.
  await within(dialog).findByText(
    "Created The Office as an automatic collection.",
  );
  await within(dialog).findByText(/No suggestions right now/);
  expect(screen.getByRole("dialog", { name: "Discover collections" })).toBe(
    dialog,
  );
  expect(api.requestsTo(`${recommendations}/acceptance`)[0]?.body).toEqual({
    criterion: { kind: "series", tmdbId: 2316 },
    mode: "automatic",
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(
    await within(
      screen.getByRole("tabpanel", { name: "Automatic" }),
    ).findByRole("button", { name: /^Open The Office/ }),
  ).toBeTruthy();
});

it("saves a recommendation as a manual collection, or dismisses it", async () => {
  const api = renderApp();
  const recommendations = "/media-collections/recommendations";
  api.reply(recommendations, [officeRecommendation]);
  api.reply(`${recommendations}/dismissal`, null, "POST", 204);
  // The acceptance is refused, so the dialog stays open for the dismissal.
  api.reply(
    `${recommendations}/acceptance`,
    { error: { code: "recommendation_decided", message: "Already decided" } },
    "POST",
    409,
  );
  fireEvent.click(await screen.findByRole("tab", { name: "Automatic" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Discover collections…" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Discover collections",
  });
  const card = (await within(dialog).findByText("The Office")).closest("li")!;

  fireEvent.click(
    within(card).getByRole("button", {
      name: "Save The Office as a manual collection",
    }),
  );
  await waitFor(() =>
    expect(api.requestsTo(`${recommendations}/acceptance`)[0]?.body).toEqual({
      criterion: { kind: "series", tmdbId: 2316 },
      mode: "manual",
    }),
  );
  await within(dialog).findByText("Already decided");
  fireEvent.click(
    within(card).getByRole("button", { name: "Dismiss The Office" }),
  );

  await waitFor(() =>
    expect(api.requestsTo(`${recommendations}/dismissal`)[0]?.body).toEqual({
      criterion: { kind: "series", tmdbId: 2316 },
    }),
  );
});

it("lists dismissed recommendations under Show dismissed and restores one", async () => {
  const api = renderApp();
  const recommendations = "/media-collections/recommendations";
  api.reply(`${recommendations}/restoration`, null, "POST", 204);
  api.handle(recommendations, (request) =>
    api.response(
      request.query.get("dismissed") === "true"
        ? [{ ...officeRecommendation, decision: "dismissed" }]
        : [],
    ),
  );
  fireEvent.click(await screen.findByRole("tab", { name: "Automatic" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Discover collections…" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Discover collections",
  });
  await within(dialog).findByText(/No suggestions right now/);

  fireEvent.click(within(dialog).getByLabelText("Show dismissed"));
  fireEvent.click(
    await within(dialog).findByRole("button", { name: "Restore The Office" }),
  );

  await waitFor(() =>
    expect(api.requestsTo(`${recommendations}/restoration`)[0]?.body).toEqual({
      criterion: { kind: "series", tmdbId: 2316 },
    }),
  );
});
