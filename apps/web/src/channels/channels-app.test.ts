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
import { ChannelsApp } from "./channels-app.js";
import { ProgrammingEditor } from "./programming/programming-editor.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("keeps a saved delete absent and retries cleanup on the same ID", async () => {
  const api = new BrowserApi();
  api.reply("/channels", [adminFixtures.channels[0]]);
  api.handle(
    "/channels/one",
    () => {
      // The failed follow-up read must not turn a committed delete back into an enabled row.
      api.reply(
        "/channels",
        { error: { code: "offline", message: "Follow-up read failed" } },
        "GET",
        503,
      );
      return api.response(
        {
          error: {
            code: "channel_runtime_cleanup_failed",
            message: "Channel was deleted but cleanup did not finish",
            channelId: "one",
            operation: "delete",
            persistenceCommitted: true,
            retryable: true,
          },
        },
        503,
      );
    },
    "DELETE",
  );
  vi.stubGlobal("fetch", api.fetch);
  const view = render(createElement(ChannelsApp, { visible: true }));
  fireEvent.click(await screen.findByRole("button", { name: "Delete…" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Delete channel permanently" }),
  );
  await screen.findByText("Channel deleted. Configuration saved.");
  await screen.findByText(/No channels yet/);
  view.unmount();
  render(createElement(ChannelsApp, { visible: true }));
  expect(
    screen.getByRole("button", { name: "Retry runtime cleanup" }),
  ).toBeTruthy();
  api.reply("/channels/one", undefined, "DELETE", 204);
  api.reply("/channels", []);
  fireEvent.click(
    screen.getByRole("button", { name: "Retry runtime cleanup" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Retry runtime cleanup" }),
    ).toBeNull(),
  );
  expect(
    api.requests
      .filter((request) => request.method === "DELETE")
      .map((request) => request.path),
  ).toEqual(["/channels/one", "/channels/one"]);
  expect(api.requests.some((request) => request.method === "POST")).toBe(false);
});

it("reports a rejected re-enable as still disabled, then retries its earlier stop", async () => {
  const api = new BrowserApi();
  api.reply("/channels", [{ ...adminFixtures.channels[0], enabled: false }]);
  api.reply(
    "/channels/one",
    {
      error: {
        code: "channel_runtime_cleanup_failed",
        message: "Earlier cleanup must finish before enabling",
        channelId: "one",
        operation: "disable",
        persistenceCommitted: false,
      },
    },
    "PATCH",
    503,
  );
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(ChannelsApp, { visible: true }));
  fireEvent.click(await screen.findByRole("button", { name: "Enable" }));
  await screen.findByText("Channel remains disabled. Re-enable was not saved.");
  api.reply(
    "/channels/one",
    { ...adminFixtures.channels[0], enabled: false },
    "PATCH",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Retry runtime cleanup" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Retry runtime cleanup" }),
    ).toBeNull(),
  );
  expect(
    api.requests
      .filter((request) => request.method === "PATCH")
      .map((request) => request.body),
  ).toEqual([{ enabled: true }, { enabled: false }]);
});

// A saved assignment of the favorites collection, as the server lists it.
function favoritesAssignment(playbackMode: string, count = 3) {
  return {
    id: "assignment",
    participation: "default",
    playbackMode,
    ordinaryStretch: { kind: "programs", count },
    marathonStretch: null,
    members: [{ kind: "collection", mediaCollectionId: "favorites" }],
  };
}

it("single-item programming sends no collection playback mode and reloads the backend schedule", async () => {
  const api = new BrowserApi();
  api.reply("/channels/one/programming-assignments", []);
  api.reply("/media-collections", adminFixtures.collections);
  api.reply("/media-items", { items: adminFixtures.media, total: 2 });
  api.reply(
    "/channels/one/programming-assignments",
    {
      id: "assignment",
      playbackMode: null,
      ordinaryStretch: { kind: "programs", count: 1 },
      marathonStretch: null,
      members: [{ kind: "media_item", mediaItemId: "z" }],
    },
    "POST",
  );
  api.reply("/channels/one/schedule", { scheduleRevision: 9, entries: [] });
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(ProgrammingEditor, { channelId: "one", visible: true }));
  await screen.findByText(/No programming assigned/);
  fireEvent.change(screen.getByLabelText("Source type"), {
    target: { value: "media_item" },
  });
  await screen.findByRole("option", { name: "Alpha (available)" });
  fireEvent.change(screen.getByLabelText("Programming source"), {
    target: { value: "z" },
  });
  expect(screen.queryByLabelText("Playback mode")).toBeNull();
  expect(screen.queryByLabelText("Programs per turn")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Save programming" }));
  await screen.findByText(/revision 9/);
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

it("preserves an unsaved programming mode across minimize and restore", async () => {
  const api = new BrowserApi();
  api.reply("/channels/one/programming-assignments", [
    favoritesAssignment("chronological"),
  ]);
  api.reply("/media-collections", adminFixtures.collections);
  vi.stubGlobal("fetch", api.fetch);
  const view = render(
    createElement(ProgrammingEditor, { channelId: "one", visible: true }),
  );
  await waitFor(() =>
    expect(
      screen.getByLabelText<HTMLSelectElement>("Programming source").value,
    ).toBe("favorites"),
  );
  fireEvent.change(screen.getByLabelText("Playback mode"), {
    target: { value: "random" },
  });
  view.rerender(
    createElement(ProgrammingEditor, { channelId: "one", visible: false }),
  );
  view.rerender(
    createElement(ProgrammingEditor, { channelId: "one", visible: true }),
  );
  await waitFor(() =>
    expect(
      api.requests.filter((request) =>
        request.path.endsWith("programming-assignments"),
      ),
    ).toHaveLength(2),
  );
  expect(screen.getByLabelText<HTMLSelectElement>("Playback mode").value).toBe(
    "random",
  );
});

it.each([
  ["episode", /Plays by series, season, and episode/],
  ["release", /Plays by release or air date/],
])(
  "saves %s order, explains it, and shows it when reopened",
  async (playbackMode, hint) => {
    const api = new BrowserApi();
    api.reply("/channels/one/programming-assignments", [
      favoritesAssignment("chronological"),
    ]);
    api.reply("/media-collections", adminFixtures.collections);
    api.reply("/channels/one/schedule", { scheduleRevision: 2, entries: [] });
    api.handle(
      "/channels/one/programming-assignments/assignment",
      () => {
        api.reply("/channels/one/programming-assignments", [
          favoritesAssignment(playbackMode),
        ]);
        return api.response(favoritesAssignment(playbackMode));
      },
      "PATCH",
    );
    vi.stubGlobal("fetch", api.fetch);
    const view = render(
      createElement(ProgrammingEditor, { channelId: "one", visible: true }),
    );
    await waitFor(() =>
      expect(
        screen.getByLabelText<HTMLSelectElement>("Programming source").value,
      ).toBe("favorites"),
    );
    expect(
      within(screen.getByLabelText("Playback mode"))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Collection order", "Episode order", "Release order", "Random"]);

    fireEvent.change(screen.getByLabelText("Playback mode"), {
      target: { value: playbackMode },
    });
    const hintId = screen
      .getByLabelText("Playback mode")
      .getAttribute("aria-describedby");
    expect(document.getElementById(hintId!)?.textContent).toMatch(hint);
    fireEvent.click(screen.getByRole("button", { name: "Save programming" }));
    await screen.findByText(/revision 2/);
    view.unmount();
    render(
      createElement(ProgrammingEditor, { channelId: "one", visible: true }),
    );

    expect(
      api.requests.find((request) => request.method === "PATCH")?.body,
    ).toEqual({
      participation: "default",
      playbackMode,
      ordinaryStretch: { kind: "programs", count: 3 },
      marathonStretch: null,
      members: [{ kind: "collection", mediaCollectionId: "favorites" }],
    });
    await waitFor(() =>
      expect(
        screen.getByLabelText<HTMLSelectElement>("Playback mode").value,
      ).toBe(playbackMode),
    );
  },
);

it("refreshes the order preview when the playback mode changes", async () => {
  const api = new BrowserApi();
  api.reply("/channels/one/programming-assignments", [
    favoritesAssignment("chronological"),
  ]);
  api.reply("/media-collections", adminFixtures.collections);
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
  api.handle(
    "/channels/one/programming-assignments/assignment/preview",
    (request) => {
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
    },
  );
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(ProgrammingEditor, { channelId: "one", visible: true }));
  const playOrder = async () =>
    within(await screen.findByRole("list", { name: "Play order" }))
      .getAllByRole("listitem")
      .map((item) => item.textContent);

  await waitFor(async () =>
    expect(await playOrder()).toEqual([
      expect.stringContaining("Diversity Day"),
      expect.stringContaining("Pilot"),
    ]),
  );
  expect(
    screen.getByRole("list", { name: "Upcoming selections" }).textContent,
  ).toContain("Diversity Day");

  fireEvent.change(screen.getByLabelText("Playback mode"), {
    target: { value: "episode" },
  });

  await waitFor(async () =>
    expect(await playOrder()).toEqual([
      expect.stringContaining("The Office: Pilot"),
      expect.stringContaining("Diversity Day"),
    ]),
  );
  screen.getByText("Save this mode to see its upcoming selections.");

  fireEvent.change(screen.getByLabelText("Playback mode"), {
    target: { value: "random" },
  });

  await screen.findByText(/Random has no fixed order/);
  expect(
    api
      .requestsTo("/channels/one/programming-assignments/assignment/preview")
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

it("confirms a progress reset in a dialog; cancel sends nothing", async () => {
  const api = new BrowserApi();
  api.reply("/channels/one/programming-assignments", [
    favoritesAssignment("episode"),
  ]);
  api.reply("/media-collections", adminFixtures.collections);
  api.reply("/channels/one/schedule", { scheduleRevision: 3, entries: [] });
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
  api.reply(
    "/channels/one/programming-assignments/assignment/preview",
    upcoming("Mid-season"),
  );
  api.handle(
    "/channels/one/programming-assignments/assignment/progress-reset",
    () => {
      api.reply(
        "/channels/one/programming-assignments/assignment/preview",
        upcoming("Pilot"),
      );
      return api.response(undefined, 204);
    },
    "POST",
  );
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(ProgrammingEditor, { channelId: "one", visible: true }));
  const restart = await screen.findByRole("button", {
    name: "Restart from the beginning…",
  });

  fireEvent.click(restart);
  const dialog = await screen.findByRole("dialog", {
    name: "Restart from the beginning",
  });
  expect(dialog.textContent).toMatch(
    /every later schedule entry is regenerated/,
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

  expect(screen.queryByRole("dialog")).toBeNull();
  expect(
    api.requestsTo(
      "/channels/one/programming-assignments/assignment/progress-reset",
    ),
  ).toEqual([]);

  fireEvent.click(restart);
  fireEvent.click(
    within(await screen.findByRole("dialog")).getByRole("button", {
      name: "Restart progress",
    }),
  );

  // The pre-reset list must never stand in for the regenerated one.
  const dialogText = () => screen.getByRole("dialog").textContent;
  await screen.findByText(/restarts in episode order/);
  expect(dialogText()).not.toContain("Mid-season");
  await waitFor(() =>
    expect(
      within(screen.getByRole("dialog")).getByRole("list", {
        name: "Upcoming selections",
      }).textContent,
    ).toContain("Pilot"),
  );
  expect(
    api
      .requestsTo(
        "/channels/one/programming-assignments/assignment/progress-reset",
      )
      .map((request) => request.body),
  ).toEqual([{ mediaCollectionId: "favorites" }]);
});

it("shows a collection's programs per turn and saves an edited count", async () => {
  const api = new BrowserApi();
  api.reply("/channels/one/programming-assignments", [
    favoritesAssignment("chronological", 4),
  ]);
  api.reply("/media-collections", adminFixtures.collections);
  api.reply("/channels/one/schedule", { scheduleRevision: 5, entries: [] });
  api.reply(
    "/channels/one/programming-assignments/assignment",
    favoritesAssignment("chronological", 2),
    "PATCH",
  );
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(ProgrammingEditor, { channelId: "one", visible: true }));
  const count = () =>
    screen.getByLabelText<HTMLInputElement>("Programs per turn");
  await waitFor(() => expect(count().value).toBe("4"));

  fireEvent.change(count(), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "Save programming" }));

  await screen.findByText(/revision 5/);
  expect(
    api.requests.find((request) => request.method === "PATCH")?.body,
  ).toEqual({
    participation: "default",
    playbackMode: "chronological",
    ordinaryStretch: { kind: "programs", count: 2 },
    marathonStretch: null,
    members: [{ kind: "collection", mediaCollectionId: "favorites" }],
  });
});

it("keeps a rejected create in its dialog, then selects the created channel", async () => {
  const api = new BrowserApi();
  api.reply("/channels", []);
  api.reply(
    "/channels",
    {
      error: { code: "validation_failed", message: "Channel number is taken" },
    },
    "POST",
    409,
  );
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(ChannelsApp, { visible: true }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Create a channel…" }),
  );
  const dialog = screen.getByRole("dialog", { name: "New channel" });
  fireEvent.change(screen.getByLabelText("Channel number"), {
    target: { value: "69" },
  });
  fireEvent.change(screen.getByLabelText("Channel name"), {
    target: { value: "Northwoods TV" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create channel" }));
  expect(
    (await screen.findByText("Channel number is taken")).closest(
      '[role="dialog"]',
    ),
  ).toBe(dialog);

  api.reply("/channels", adminFixtures.channels[0], "POST");
  api.reply("/channels", [adminFixtures.channels[0]]);
  fireEvent.click(screen.getByRole("button", { name: "Create channel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Northwoods TV" })
        .closest("tr")
        ?.classList.contains("selected-row"),
    ).toBe(true),
  );
  expect(
    api.requests.find((request) => request.method === "POST")?.body,
  ).toEqual({ number: "69", name: "Northwoods TV" });
});

it("opens a delete confirmation without an earlier action's error", async () => {
  const api = new BrowserApi();
  api.reply("/channels", [adminFixtures.channels[0]]);
  api.reply(
    "/channels/one",
    { error: { code: "offline", message: "Disable failed" } },
    "PATCH",
    503,
  );
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(ChannelsApp, { visible: true }));
  fireEvent.click(await screen.findByRole("button", { name: "Disable" }));
  await screen.findByText("Disable failed");

  fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
  const dialog = screen.getByRole("dialog", { name: "Delete channel" });
  expect(dialog.textContent).not.toContain("Disable failed");
  expect(screen.queryByText("Disable failed")).toBeNull();
});

it("selects a channel from anywhere on its row except the row's buttons", async () => {
  const api = new BrowserApi();
  api.reply("/channels", adminFixtures.channels);
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(ChannelsApp, { visible: true }));
  const selected = (name: string) =>
    screen
      .getByRole("button", { name })
      .closest("tr")
      ?.classList.contains("selected-row");

  fireEvent.click(await screen.findByText("70"));
  expect(selected("Second channel")).toBe(true);

  fireEvent.click(screen.getAllByRole("button", { name: "Disable" })[0]);
  expect(selected("Northwoods TV")).toBe(false);
  expect(selected("Second channel")).toBe(true);
});

it("adds a second assignment after the first, in its own empty form", async () => {
  const api = new BrowserApi();
  api.reply("/channels/one/programming-assignments", [
    favoritesAssignment("chronological"),
  ]);
  api.reply("/media-collections", [
    ...adminFixtures.collections,
    collectionWith("other", "Other"),
  ]);
  api.reply("/channels/one/schedule", { scheduleRevision: 6, entries: [] });
  api.reply("/programming-assignments/stretch-suggestion", {
    ordinaryStretch: { kind: "programs", count: 3 },
    contentKind: "episodes",
  });
  api.handle(
    "/channels/one/programming-assignments",
    () => {
      api.reply("/channels/one/programming-assignments", [
        favoritesAssignment("chronological"),
        {
          ...favoritesAssignment("random"),
          id: "second",
          members: [{ kind: "collection", mediaCollectionId: "other" }],
        },
      ]);
      return api.response({}, 201);
    },
    "POST",
  );
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(ProgrammingEditor, { channelId: "one", visible: true }));

  fireEvent.click(
    await screen.findByRole("button", { name: "Add an assignment" }),
  );
  const added = screen.getByRole("group", { name: "New assignment" });
  fireEvent.change(within(added).getByLabelText("Programming source"), {
    target: { value: "other" },
  });
  // The server suggests three programs a turn for this collection.
  await waitFor(() =>
    expect(
      within(added).getByLabelText<HTMLInputElement>("Programs per turn").value,
    ).toBe("3"),
  );
  fireEvent.change(within(added).getByLabelText("Playback mode"), {
    target: { value: "random" },
  });
  fireEvent.click(
    within(added).getByRole("button", { name: "Save programming" }),
  );

  await screen.findByRole("group", { name: "Assignment 2" });
  expect(screen.queryByRole("group", { name: "New assignment" })).toBeNull();
  expect(
    api.requests.find((request) => request.method === "POST")?.body,
  ).toEqual({
    participation: "default",
    playbackMode: "random",
    ordinaryStretch: { kind: "programs", count: 3 },
    marathonStretch: null,
    members: [
      {
        kind: "collection",
        mediaCollectionId: "other",
      },
    ],
  });
});

it("moves an assignment later in saved order", async () => {
  const api = new BrowserApi();
  const second = {
    ...favoritesAssignment("random"),
    id: "second",
    members: [{ kind: "collection", mediaCollectionId: "other" }],
  };
  api.reply("/channels/one/programming-assignments", [
    favoritesAssignment("chronological"),
    second,
  ]);
  api.reply("/media-collections", adminFixtures.collections);
  api.reply("/channels/one/schedule", { scheduleRevision: 7, entries: [] });
  api.reply("/channels/one/programming-assignments/order", [], "PUT");
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(ProgrammingEditor, { channelId: "one", visible: true }));
  const list = await screen.findByRole("list", {
    name: "Programming assignments",
  });
  await waitFor(() => expect(list.children).toHaveLength(2));

  const [first] = [...list.children] as HTMLElement[];
  expect(
    within(first).getByRole<HTMLButtonElement>("button", { name: "Move up" })
      .disabled,
  ).toBe(true);
  fireEvent.click(within(first).getByRole("button", { name: "Move down" }));

  await screen.findByText(/revision 7/);
  expect(
    api.requestsTo("/channels/one/programming-assignments/order")[0]?.body,
  ).toEqual({ assignmentIds: ["second", "assignment"] });
});

it("adds, reorders, and saves an assignment's members", async () => {
  const api = new BrowserApi();
  api.reply("/channels/one/programming-assignments", [
    favoritesAssignment("chronological"),
  ]);
  api.reply("/media-collections", [
    ...adminFixtures.collections,
    collectionWith("other", "Other"),
  ]);
  api.reply("/channels/one/schedule", { scheduleRevision: 8, entries: [] });
  api.reply(
    "/channels/one/programming-assignments/assignment",
    favoritesAssignment("chronological"),
    "PATCH",
  );
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(ProgrammingEditor, { channelId: "one", visible: true }));
  const form = await screen.findByRole("group", { name: "Assignment 1" });
  await waitFor(() =>
    expect(
      within(form).getByLabelText<HTMLSelectElement>("Programming source")
        .value,
    ).toBe("favorites"),
  );

  fireEvent.click(within(form).getByRole("button", { name: "Add member" }));
  const rows = () =>
    within(within(form).getByRole("list", { name: "Members" })).getAllByRole(
      "listitem",
    );
  fireEvent.change(within(rows()[1]).getByLabelText("Programming source"), {
    target: { value: "other" },
  });
  fireEvent.click(
    within(rows()[1]).getByRole("button", { name: "Move member up" }),
  );
  fireEvent.click(
    within(form).getByRole("button", { name: "Save programming" }),
  );

  await screen.findByText(/revision 8/);
  expect(
    api.requests.find((request) => request.method === "PATCH")?.body,
  ).toEqual({
    participation: "default",
    playbackMode: "chronological",
    ordinaryStretch: { kind: "programs", count: 3 },
    marathonStretch: null,
    members: [
      { kind: "collection", mediaCollectionId: "other" },
      { kind: "collection", mediaCollectionId: "favorites" },
    ],
  });
});

it("asks for a turn length when the server has no suggestion, then saves an airtime range", async () => {
  const api = new BrowserApi();
  api.reply("/channels/one/programming-assignments", []);
  api.reply("/media-collections", adminFixtures.collections);
  api.reply("/channels/one/schedule", { scheduleRevision: 9, entries: [] });
  api.reply("/programming-assignments/stretch-suggestion", {
    ordinaryStretch: null,
    contentKind: null,
  });
  api.reply("/channels/one/programming-assignments", {}, "POST", 201);
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(ProgrammingEditor, { channelId: "one", visible: true }));
  const form = await screen.findByRole("group", { name: "New assignment" });

  fireEvent.change(within(form).getByLabelText("Programming source"), {
    target: { value: "favorites" },
  });

  await within(form).findByText(/Choose how long each turn runs/);
  expect(
    api
      .requestsTo("/programming-assignments/stretch-suggestion")
      .map((request) => request.query.get("mediaCollectionIds")),
  ).toContain("favorites");
  const save = within(form).getByRole<HTMLButtonElement>("button", {
    name: "Save programming",
  });
  expect(
    within(form).getByLabelText<HTMLInputElement>("Programs per turn").value,
  ).toBe("");
  fireEvent.change(within(form).getByLabelText("Turn length"), {
    target: { value: "airtime_range" },
  });
  expect(within(form).getByText(/runs over/).textContent).toMatch(
    /picks one target/,
  );
  fireEvent.change(within(form).getByLabelText("At least minutes"), {
    target: { value: "60" },
  });
  fireEvent.change(within(form).getByLabelText("At most minutes"), {
    target: { value: "120" },
  });
  fireEvent.click(save);

  await screen.findByText(/revision 9/);
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

it("allows marathons on an assignment with a suggested longer length", async () => {
  const api = new BrowserApi();
  api.reply("/channels/one/programming-assignments", [
    favoritesAssignment("chronological"),
  ]);
  api.reply("/media-collections", adminFixtures.collections);
  api.reply("/channels/one/programming-settings", {
    marathonChancePercent: 0,
    marathonMinOrdinaryRounds: 2,
  });
  api.reply("/channels/one/schedule", { scheduleRevision: 10, entries: [] });
  api.reply(
    "/channels/one/programming-assignments/assignment",
    favoritesAssignment("chronological"),
    "PATCH",
  );
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(ProgrammingEditor, { channelId: "one", visible: true }));
  const form = await screen.findByRole("group", { name: "Assignment 1" });
  await waitFor(() =>
    expect(
      within(form).getByLabelText<HTMLInputElement>("Programs per turn").value,
    ).toBe("3"),
  );

  fireEvent.click(within(form).getByLabelText("Allow marathons"));

  expect(
    within(form).getByLabelText<HTMLInputElement>("Marathon programs per turn")
      .value,
  ).toBe("6");
  fireEvent.click(
    within(form).getByRole("button", { name: "Save programming" }),
  );
  await screen.findByText(/revision 10/);
  expect(
    api.requests.find((request) => request.method === "PATCH")?.body,
  ).toMatchObject({ marathonStretch: { kind: "programs", count: 6 } });
});

it("offers the suggested marathon chance and cooldown once an assignment allows marathons", async () => {
  const api = new BrowserApi();
  api.reply("/channels/one/programming-assignments", [
    {
      ...favoritesAssignment("chronological"),
      marathonStretch: { kind: "programs", count: 6 },
    },
  ]);
  api.reply("/media-collections", adminFixtures.collections);
  api.reply("/channels/one/programming-settings", {
    marathonChancePercent: 0,
    marathonMinOrdinaryRounds: 2,
  });
  api.reply("/channels/one/schedule", { scheduleRevision: 11, entries: [] });
  api.reply(
    "/channels/one/programming-settings",
    { marathonChancePercent: 10, marathonMinOrdinaryRounds: 2 },
    "PUT",
  );
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(ProgrammingEditor, { channelId: "one", visible: true }));
  const marathons = await screen.findByRole("group", { name: "Marathons" });

  fireEvent.click(
    within(marathons).getByRole("button", {
      name: "Use the suggested 10% and two rounds",
    }),
  );
  fireEvent.click(
    within(marathons).getByRole("button", { name: "Save marathon settings" }),
  );

  await screen.findByText(/revision 11/);
  expect(
    api.requests.find((request) => request.method === "PUT")?.body,
  ).toEqual({ marathonChancePercent: 10, marathonMinOrdinaryRounds: 2 });
});

it("keeps an allowed marathon longer than a turn length suggested afterwards", async () => {
  const api = new BrowserApi();
  api.reply("/channels/one/programming-assignments", []);
  api.reply("/media-collections", adminFixtures.collections);
  api.reply("/programming-assignments/stretch-suggestion", {
    ordinaryStretch: { kind: "programs", count: 3 },
    contentKind: "episodes",
  });
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(ProgrammingEditor, { channelId: "one", visible: true }));
  const form = await screen.findByRole("group", { name: "New assignment" });

  fireEvent.click(within(form).getByLabelText("Allow marathons"));
  fireEvent.change(within(form).getByLabelText("Programming source"), {
    target: { value: "favorites" },
  });

  await waitFor(() =>
    expect(
      within(form).getByLabelText<HTMLInputElement>(
        "Marathon programs per turn",
      ).value,
    ).toBe("6"),
  );
  expect(
    within(form).getByLabelText<HTMLInputElement>("Programs per turn").value,
  ).toBe("3");
});

it("explains upcoming turns: continuation, overrun, marathons, and skips", async () => {
  const api = new BrowserApi();
  api.reply("/channels/one/programming-assignments", [
    favoritesAssignment("chronological"),
  ]);
  api.reply("/media-collections", adminFixtures.collections);
  const program = (title: string) => ({
    mediaItemId: title,
    title,
    startsAt: "2026-10-14T20:00:00.000Z",
    endsAt: "2026-10-14T20:22:00.000Z",
  });
  const turn = {
    assignmentId: "assignment",
    member: {
      kind: "collection",
      mediaCollectionId: "favorites",
      playbackMode: "chronological",
    },
    roundNumber: 2,
    turnIndex: 0,
    continues: false,
    winningRuleId: null,
    skippedRules: [],
    decidedAt: "2026-10-14T20:00:00.000Z",
    settingOrigins: { ordinary: "assignment", marathon: "assignment" },
    startsAt: "2026-10-14T20:00:00.000Z",
    endsAt: "2026-10-14T21:06:00.000Z",
    size: { kind: "airtime", value: 60 },
    marathon: false,
    marathonChancePercent: null,
    airtimeMinutes: 66,
    overrunMinutes: 6,
    programs: [program("One"), program("Two"), program("Three")],
  };
  api.reply("/channels/one/programming-preview", {
    configurationRevision: 3,
    turns: [
      {
        ...turn,
        continues: true,
        overrunMinutes: null,
        airtimeMinutes: 22,
        programs: [program("One")],
      },
      turn,
      {
        ...turn,
        size: { kind: "programs", value: 6 },
        marathon: true,
        marathonChancePercent: 10,
        overrunMinutes: null,
      },
    ],
    skips: [
      { assignmentId: "empty", roundNumber: 2, reasons: ["empty_collection"] },
    ],
  });
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(ProgrammingEditor, { channelId: "one", visible: true }));

  const turns = await screen.findByRole("list", { name: "Upcoming turns" });
  const lines = within(turns)
    .getAllByRole("listitem")
    .map((item) => item.textContent);
  expect(lines[0]).toMatch(
    /Favorites · 1 program, 22 min · continues the turn on air/,
  );
  expect(lines[1]).toMatch(
    /3 programs, 66 min · 6 min over its 60-minute target/,
  );
  expect(lines[2]).toMatch(/marathon, from this round's 10% chance/);
  expect(
    screen.getByRole("list", { name: "Skipped assignments" }).textContent,
  ).toMatch(/Round 2 skips an assignment: its collection is empty/);
});

it("lets the airing program finish by default when rebuilding", async () => {
  const api = new BrowserApi();
  api.reply("/channels/one/programming-assignments", [
    favoritesAssignment("chronological"),
  ]);
  api.reply("/media-collections", adminFixtures.collections);
  api.reply("/channels/one/schedule/generate", {}, "POST");
  api.reply("/channels/one/schedule", { scheduleRevision: 12, entries: [] });
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(ProgrammingEditor, { channelId: "one", visible: true }));

  fireEvent.click(
    await screen.findByRole("button", { name: "Rebuild the schedule…" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Rebuild the schedule" });
  expect(
    within(dialog).getByRole<HTMLInputElement>("radio", {
      name: "Let it finish",
    }).checked,
  ).toBe(true);
  fireEvent.click(within(dialog).getByRole("button", { name: "Rebuild" }));

  await within(dialog).findByText(/rebuilt after what is airing now/);
  expect(
    api.requests.find((request) => request.method === "POST")?.body,
  ).toEqual({ regenerate: true });
  expect(api.requestsTo("/channels/one/programming/rebuild")).toEqual([]);
});

it("stops the airing program on request, disclosing the disconnect, and keeps a failed cleanup for retry with the same key after the window closes", async () => {
  const api = new BrowserApi();
  api.reply("/channels", [adminFixtures.channels[0]]);
  api.reply("/channels/one/programming-assignments", [
    favoritesAssignment("chronological"),
  ]);
  api.reply("/media-collections", adminFixtures.collections);
  api.reply("/channels/one/schedule", { scheduleRevision: 13, entries: [] });
  api.reply(
    "/channels/one/programming/rebuild",
    { rebuilt: true, stopFailed: true },
    "POST",
  );
  vi.stubGlobal("fetch", api.fetch);
  const editor = render(
    createElement(ProgrammingEditor, { channelId: "one", visible: true }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Rebuild the schedule…" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Rebuild the schedule" });

  fireEvent.click(
    within(dialog).getByRole("radio", {
      name: "Stop it now and rebuild the schedule",
    }),
  );
  expect(dialog.textContent).toMatch(/disconnected and must tune in again/);
  fireEvent.click(within(dialog).getByRole("button", { name: "Rebuild" }));
  await within(dialog).findByText(/could not be stopped/);
  editor.unmount();

  // The retry outlives the closed window and repeats the rebuild's key.
  render(createElement(ChannelsApp, { visible: true }));
  await screen.findByText("Schedule rebuilt with fresh programming.");
  api.reply(
    "/channels/one/programming/rebuild",
    { rebuilt: false, stopFailed: false },
    "POST",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Retry runtime cleanup" }),
  );

  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Retry runtime cleanup" }),
    ).toBeNull(),
  );
  const keys = api
    .requestsTo("/channels/one/programming/rebuild")
    .map(
      (request) => (request.body as { idempotencyKey: string }).idempotencyKey,
    );
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
});

it("saves an assignment kept out of normal rotation and shows it when reopened", async () => {
  const api = new BrowserApi();
  api.reply("/channels/one/programming-assignments", [
    favoritesAssignment("chronological"),
  ]);
  api.reply("/media-collections", adminFixtures.collections);
  api.reply("/channels/one/schedule", { scheduleRevision: 2, entries: [] });
  const ruleOnly = {
    ...favoritesAssignment("chronological"),
    participation: "rule_only",
  };
  api.handle(
    "/channels/one/programming-assignments/assignment",
    () => {
      api.reply("/channels/one/programming-assignments", [ruleOnly]);
      return api.response(ruleOnly);
    },
    "PATCH",
  );
  vi.stubGlobal("fetch", api.fetch);
  const view = render(
    createElement(ProgrammingEditor, { channelId: "one", visible: true }),
  );
  const rotation = await screen.findByLabelText<HTMLInputElement>(
    "Plays in normal rotation",
  );
  await waitFor(() => expect(rotation.checked).toBe(true));

  fireEvent.click(rotation);
  screen.getByText("Airs only while a programming rule selects it.");
  fireEvent.click(screen.getByRole("button", { name: "Save programming" }));
  await screen.findByText(/revision 2/);
  view.unmount();
  render(createElement(ProgrammingEditor, { channelId: "one", visible: true }));

  expect(
    api.requests.find((request) => request.method === "PATCH")?.body,
  ).toMatchObject({ participation: "rule_only" });
  await waitFor(() =>
    expect(
      screen.getByLabelText<HTMLInputElement>("Plays in normal rotation")
        .checked,
    ).toBe(false),
  );
});

it("explains which rule chose each turn, the rules it passed over, and where its settings came from", async () => {
  const api = new BrowserApi();
  api.reply("/channels/one/programming-assignments", [
    favoritesAssignment("chronological"),
  ]);
  api.reply("/media-collections", adminFixtures.collections);
  const rule = (id: string, name: string) => ({
    id,
    name,
    behavior: "feature",
    priority: 1,
    dates: { kind: "any" },
    weekdays: null,
    window: { startMinute: 18 * 60, endMinute: 23 * 60 },
    sources: [],
  });
  api.reply("/channels/one/programming-rules", [
    rule("fridays", "Friday movies"),
    rule("broken", "Nothing to air"),
  ]);
  const turn = {
    assignmentId: "assignment",
    member: {
      kind: "collection",
      mediaCollectionId: "favorites",
      playbackMode: "chronological",
    },
    roundNumber: 1,
    turnIndex: 0,
    continues: false,
    winningRuleId: "fridays",
    skippedRules: [{ ruleId: "broken", reason: "no_usable_source" }],
    decidedAt: "2026-10-16T22:00:00.000Z",
    settingOrigins: { ordinary: "rule", marathon: "disabled" },
    startsAt: "2026-10-16T22:00:00.000Z",
    endsAt: "2026-10-16T23:30:00.000Z",
    size: { kind: "programs", value: 2 },
    marathon: false,
    marathonChancePercent: null,
    airtimeMinutes: 90,
    overrunMinutes: null,
    programs: [
      {
        mediaItemId: "a",
        title: "A",
        startsAt: "2026-10-16T22:00:00.000Z",
        endsAt: "2026-10-16T23:30:00.000Z",
      },
    ],
  };
  api.reply("/channels/one/programming-preview", {
    configurationRevision: 4,
    turns: [
      turn,
      {
        ...turn,
        winningRuleId: null,
        skippedRules: [],
        settingOrigins: { ordinary: "assignment", marathon: "assignment" },
      },
    ],
    skips: [],
  });
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(ProgrammingEditor, { channelId: "one", visible: true }));

  const turns = await screen.findByRole("list", { name: "Upcoming turns" });
  await waitFor(() =>
    expect(within(turns).getAllByRole("listitem")[0]?.textContent).toMatch(
      /chosen by Friday movies/,
    ),
  );
  const [ruled, defaulted] = within(turns)
    .getAllByRole("listitem")
    .map((item) => item.textContent);
  expect(ruled).toMatch(
    /passed over Nothing to air: none of its sources can air/,
  );
  expect(ruled).toMatch(
    /the rule.s turn length · marathons off under the rule/,
  );
  expect(defaulted).toMatch(/normal rotation/);
  expect(screen.getByText(/checked at program boundaries/).textContent).toMatch(
    /never promises a program starts exactly when a window opens/,
  );
});
