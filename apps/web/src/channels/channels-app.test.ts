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
import { displayClockTime } from "../controls/display-time.js";
import { BrowserApi } from "../testing/browser-api.js";
import {
  adminFixtures,
  favoritesAssignment,
} from "../testing/admin-fixtures.js";
import { ChannelWindows } from "../testing/channel-windows.js";
import { openChannelTab } from "../testing/channel-tabs.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Selects the named channel's row, which the buttons under the grid act on.
async function selectChannel(name: string) {
  fireEvent.click(await screen.findByRole("button", { name }));
}

it("keeps a saved delete absent, closes its Properties window, and retries cleanup on the same ID", async () => {
  const api = new BrowserApi();
  api.reply("/channels", [adminFixtures.channels[0]]);
  api.reply("/channels/one", adminFixtures.channels[0]);
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
  const view = render(createElement(ChannelWindows));
  fireEvent.doubleClick(
    await screen.findByRole("button", { name: "Northwoods TV" }),
  );
  await screen.findByRole("tab", { name: "Lineup" });
  fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Delete channel permanently" }),
  );
  await screen.findByText("Channel deleted. Configuration saved.");
  await screen.findByText(/No channels yet/);
  // Nothing is left to edit, so its window closed with the delete.
  expect(screen.queryByRole("tab", { name: "Lineup" })).toBeNull();
  view.unmount();
  render(createElement(ChannelWindows));
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
  render(createElement(ChannelWindows));
  await selectChannel("Northwoods TV");
  fireEvent.click(screen.getByRole("button", { name: "Enable" }));
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

const ASSIGNMENTS = "/channels/one/programming-assignments";

it("keeps a rejected create in its dialog, then selects and opens the created channel", async () => {
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
  render(createElement(ChannelWindows));
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
  api.reply("/channels/one", adminFixtures.channels[0]);
  api.reply(ASSIGNMENTS, []);
  api.reply("/media-collections", []);
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
  // The new channel opens in Channel Properties.
  await screen.findByRole("heading", { name: "69 · Northwoods TV" });
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
  render(createElement(ChannelWindows));
  await selectChannel("Northwoods TV");
  fireEvent.click(screen.getByRole("button", { name: "Disable" }));
  await screen.findByText("Disable failed");

  fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
  const dialog = screen.getByRole("dialog", { name: "Delete channel" });
  expect(dialog.textContent).not.toContain("Disable failed");
  expect(screen.queryByText("Disable failed")).toBeNull();
});

it("selects a channel from anywhere on its row except the row's buttons, and opens it only on request", async () => {
  const api = new BrowserApi();
  api.reply("/channels", adminFixtures.channels);
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(ChannelWindows));
  const selected = (name: string) =>
    screen
      .getByRole("button", { name })
      .closest("tr")
      ?.classList.contains("selected-row");

  fireEvent.click(await screen.findByText("70"));
  expect(selected("Second channel")).toBe(true);

  fireEvent.click(
    screen.getByRole("button", { name: "Actions for Northwoods TV" }),
  );
  expect(selected("Northwoods TV")).toBe(false);
  expect(selected("Second channel")).toBe(true);

  // A click only selects; Properties under the grid opens the selection.
  expect(screen.queryByRole("tab")).toBeNull();
  api.reply("/channels/two", adminFixtures.channels[1]);
  api.reply("/channels/two/programming-assignments", []);
  api.reply("/media-collections", []);
  fireEvent.click(screen.getByRole("button", { name: "Properties" }));
  await screen.findByRole("heading", { name: "70 · Second channel" });
});

it("offers Disable and Delete from a row's menu, and for the selected row under the grid", async () => {
  const api = new BrowserApi();
  api.reply("/channels", adminFixtures.channels);
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(ChannelWindows));
  const under = (name: string) => screen.getByRole("button", { name });

  await screen.findByRole("button", { name: "Northwoods TV" });
  expect(under("Disable")).toHaveProperty("disabled", true);
  expect(under("Delete…")).toHaveProperty("disabled", true);
  fireEvent.click(
    screen.getByRole("button", { name: "Actions for Northwoods TV" }),
  );
  expect(
    screen.getAllByRole("menuitem").map((item) => item.textContent),
  ).toEqual(["Watch", "Properties", "Disable", "Delete…"]);
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });

  await selectChannel("Northwoods TV");
  expect(under("Disable")).toHaveProperty("disabled", false);
  fireEvent.click(under("Delete…"));
  expect(
    screen.getByRole("dialog", { name: "Delete channel" }).textContent,
  ).toContain("Northwoods TV");
});

// The tab names Channel Properties shows for the picked channel.
const tabNames = () => screen.getAllByRole("tab").map((tab) => tab.textContent);

it("opens a channel with an empty lineup on Lineup, without Rules or Preview", async () => {
  const api = new BrowserApi();
  api.reply("/channels", adminFixtures.channels);
  api.reply("/channels/one", adminFixtures.channels[0]);
  api.reply(ASSIGNMENTS, []);
  api.reply("/media-collections", adminFixtures.collections);
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(ChannelWindows));

  fireEvent.doubleClick(
    await screen.findByRole("button", { name: "Northwoods TV" }),
  );

  await screen.findByText(/No shows yet/);
  expect(
    screen.getByRole("tab", { name: "Lineup" }).getAttribute("aria-selected"),
  ).toBe("true");
  expect(tabNames()).toEqual(["General", "Lineup", "Specials"]);
});

it("shows every tab once the lineup has a show, keeps each open channel on its own tab, and has no schedule debug line", async () => {
  const api = new BrowserApi();
  api.reply("/channels", adminFixtures.channels);
  api.reply("/channels/one", adminFixtures.channels[0]);
  api.reply("/channels/two", adminFixtures.channels[1]);
  api.reply(ASSIGNMENTS, [favoritesAssignment("chronological")]);
  api.reply("/channels/two/programming-assignments", [
    favoritesAssignment("random"),
  ]);
  api.reply("/media-collections", adminFixtures.collections);
  api.reply("/channels/one/programming-preview", {
    configurationRevision: 1,
    turns: [],
    skips: [],
  });
  api.reply("/channels/two/programming-preview", {
    configurationRevision: 1,
    turns: [],
    skips: [],
  });
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(ChannelWindows));
  fireEvent.doubleClick(
    await screen.findByRole("button", { name: "Northwoods TV" }),
  );

  // A channel with a show opens on the first tab.
  await screen.findByRole("tab", { name: "Rules" });
  expect(tabNames()).toEqual([
    "General",
    "Lineup",
    "Rules",
    "Specials",
    "Preview",
  ]);
  expect(screen.getByLabelText("Name")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
  await screen.findByRole("button", { name: "Rebuild the schedule…" });
  expect(screen.queryByLabelText("Name")).toBeNull();

  fireEvent.keyDown(screen.getByRole("button", { name: "Second channel" }), {
    key: "Enter",
  });
  // The second channel opens in a sheet of its own, on its first tab,
  // while the first keeps Preview.
  const sheet = (name: string) => screen.getByRole("region", { name });
  const chosen = (region: HTMLElement) =>
    within(region)
      .getAllByRole("tab")
      .find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent;
  await screen.findByRole("heading", { name: "70 · Second channel" });
  await within(sheet("70 · Second channel properties")).findByRole("tab", {
    name: "Rules",
  });
  expect(chosen(sheet("70 · Second channel properties"))).toBe("General");
  expect(chosen(sheet("69 · Northwoods TV properties"))).toBe("Preview");
  expect(document.body.textContent).not.toMatch(/Backend schedule/);
  expect(api.requestsTo("/channels/two/schedule")).toEqual([]);
});

it("saves the channel's number and name from General with Apply", async () => {
  const api = new BrowserApi();
  api.reply(ASSIGNMENTS, [favoritesAssignment("chronological")]);
  api.reply("/media-collections", adminFixtures.collections);
  api.reply(
    "/channels/one",
    { ...adminFixtures.channels[0], name: "Lakeside TV" },
    "PATCH",
  );
  vi.stubGlobal("fetch", api.fetch);
  await openChannelTab(api, "General");

  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Lakeside TV" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));

  await waitFor(() =>
    expect(
      api
        .requestsTo("/channels/one")
        .find((request) => request.method === "PATCH")?.body,
    ).toEqual({
      number: "69",
      name: "Lakeside TV",
    }),
  );
});

it("shows what each enabled channel is airing now and next, and asks nothing of a disabled one", async () => {
  const api = new BrowserApi();
  const [northwoods, second] = adminFixtures.channels;
  api.reply("/channels", [
    northwoods,
    second,
    { id: "three", number: "71", name: "Resting TV", enabled: false },
  ]);
  api.reply("/channels/one/now", adminFixtures.now);
  api.reply("/channels/two/now", {
    evaluatedAt: "2026-10-05T15:00:00.000Z",
    currentItem: {
      type: "filler",
      startsAt: "2026-10-05T14:45:00.000Z",
      endsAt: "2026-10-05T20:00:00.000Z",
      resumeTime: "8:00 PM",
    },
    nextItem: null,
  });
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(ChannelWindows));

  const row = async (name: string) =>
    (await screen.findByRole("button", { name })).closest("tr") as HTMLElement;
  const northwoodsRow = await row("Northwoods TV");
  expect(await within(northwoodsRow).findByText("Alpha")).toBeTruthy();
  expect(
    within(northwoodsRow).getByText(
      `Next at ${displayClockTime("2026-10-05T15:10:00.000Z")}: Zulu`,
    ),
  ).toBeTruthy();
  const secondRow = await row("Second channel");
  expect(
    await within(secondRow).findByText(
      "Off air — programming resumes at 8:00 PM",
    ),
  ).toBeTruthy();
  expect(
    within(await row("Resting TV")).getByText("Not broadcasting"),
  ).toBeTruthy();
  expect(api.requestsTo("/channels/three/now")).toEqual([]);
});

it("says why a channel has nothing on air, and keeps a row whose read failed quiet", async () => {
  const api = new BrowserApi();
  api.reply("/channels", adminFixtures.channels);
  api.reply("/channels/one/now", {
    evaluatedAt: "2026-10-05T15:00:00.000Z",
    currentItem: null,
    nextItem: null,
    reason: "schedule_gap",
  });
  api.reply(
    "/channels/two/now",
    { error: { code: "schedule_busy", message: "Busy" } },
    "GET",
    503,
  );
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(ChannelWindows));

  expect(
    await screen.findByText(
      "Nothing is scheduled right now. Check that the channel's shows have media, and its Lineup and Rules tabs.",
    ),
  ).toBeTruthy();
  const secondRow = (
    await screen.findByRole("button", { name: "Second channel" })
  ).closest("tr") as HTMLElement;
  expect(await within(secondRow).findByText("Unavailable")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("replaces what a channel aired with Unavailable when a later read fails", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    const api = new BrowserApi();
    api.reply("/channels", [adminFixtures.channels[0]]);
    api.reply("/channels/one/now", adminFixtures.now);
    vi.stubGlobal("fetch", api.fetch);
    render(createElement(ChannelWindows));
    expect(await screen.findByText("Alpha")).toBeTruthy();

    api.reply(
      "/channels/one/now",
      { error: { code: "offline", message: "Offline" } },
      "GET",
      503,
    );
    vi.advanceTimersByTime(60_000);

    expect(await screen.findByText("Unavailable")).toBeTruthy();
    expect(screen.queryByText("Alpha")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it("opens TV on the selected channel from Watch, and not on a disabled one", async () => {
  const api = new BrowserApi();
  api.reply("/channels", [
    adminFixtures.channels[0],
    { ...adminFixtures.channels[1], enabled: false },
  ]);
  vi.stubGlobal("fetch", api.fetch);
  const onWatch = vi.fn();
  render(createElement(ChannelWindows, { onWatch }));
  const watch = () => screen.getByRole("button", { name: "Watch" });

  await selectChannel("Second channel");
  expect(watch()).toHaveProperty("disabled", true);
  await selectChannel("Northwoods TV");
  fireEvent.click(watch());
  expect(onWatch).toHaveBeenCalledWith("one");

  fireEvent.click(
    screen.getByRole("button", { name: "Actions for Northwoods TV" }),
  );
  fireEvent.click(screen.getByRole("menuitem", { name: "Watch" }));
  expect(onWatch).toHaveBeenCalledTimes(2);
});

it("sends the owner to Media Library first when there are no channels and no media", async () => {
  const api = new BrowserApi();
  api.reply("/channels", []);
  api.reply("/media-items", { items: [], total: 0 });
  vi.stubGlobal("fetch", api.fetch);
  const openProgram = vi.fn();
  render(createElement(ChannelWindows, { openProgram }));

  await screen.findByText(
    "Add your media in Media Library first, then create a channel.",
  );
  expect(
    screen.queryByRole("button", { name: "Create a channel…" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open Media Library" }));

  expect(openProgram).toHaveBeenCalledWith("media");
  // One item answers the question.
  expect(
    api.requestsTo("/media-items").map((request) => request.query.get("limit")),
  ).toEqual(["1"]);
});

it("offers to create a channel when the catalog has media and there are no channels", async () => {
  const api = new BrowserApi();
  api.reply("/channels", []);
  api.reply("/media-items", { items: [adminFixtures.media[0]], total: 2 });
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(ChannelWindows));

  expect(
    await screen.findByRole("button", { name: "Create a channel…" }),
  ).toBeTruthy();
  expect(screen.queryByText(/Media Library first/)).toBeNull();
});
