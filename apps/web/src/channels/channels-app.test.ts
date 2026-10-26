// @vitest-environment jsdom
import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BrowserApi } from "../testing/browser-api.js";
import {
  adminFixtures,
  favoritesAssignment,
} from "../testing/admin-fixtures.js";
import { ChannelsApp } from "./channels-app.js";
import { openChannelTab } from "../testing/channel-tabs.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Selects the named channel's row, which the buttons under the grid act on.
async function selectChannel(name: string) {
  fireEvent.click(await screen.findByRole("button", { name }));
}

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
  await selectChannel("Northwoods TV");
  fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
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
  await selectChannel("Northwoods TV");
  fireEvent.click(screen.getByRole("button", { name: "Disable" }));
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

  fireEvent.click(
    screen.getByRole("button", { name: "Actions for Northwoods TV" }),
  );
  expect(selected("Northwoods TV")).toBe(false);
  expect(selected("Second channel")).toBe(true);
});

it("offers Disable and Delete from a row's menu, and for the selected row under the grid", async () => {
  const api = new BrowserApi();
  api.reply("/channels", adminFixtures.channels);
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(ChannelsApp, { visible: true }));
  const under = (name: string) => screen.getByRole("button", { name });

  await screen.findByRole("button", { name: "Northwoods TV" });
  expect(under("Disable")).toHaveProperty("disabled", true);
  expect(under("Delete…")).toHaveProperty("disabled", true);
  fireEvent.click(
    screen.getByRole("button", { name: "Actions for Northwoods TV" }),
  );
  expect(
    screen.getAllByRole("menuitem").map((item) => item.textContent),
  ).toEqual(["Disable", "Delete…"]);
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });

  await selectChannel("Northwoods TV");
  expect(under("Disable")).toHaveProperty("disabled", false);
  fireEvent.click(under("Delete…"));
  expect(
    screen.getByRole("dialog", { name: "Delete channel" }).textContent,
  ).toContain("Northwoods TV");
});

// The tab names the selected channel's property sheet shows.
const tabNames = () => screen.getAllByRole("tab").map((tab) => tab.textContent);

it("opens a channel with an empty lineup on Lineup, without Rules or Preview", async () => {
  const api = new BrowserApi();
  api.reply("/channels", adminFixtures.channels);
  api.reply(ASSIGNMENTS, []);
  api.reply("/media-collections", adminFixtures.collections);
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(ChannelsApp, { visible: true }));

  fireEvent.click(await screen.findByRole("button", { name: "Northwoods TV" }));

  await screen.findByText(/No shows yet/);
  expect(
    screen.getByRole("tab", { name: "Lineup" }).getAttribute("aria-selected"),
  ).toBe("true");
  expect(tabNames()).toEqual(["General", "Lineup", "Specials"]);
});

it("shows every tab once the lineup has a show, keeps the chosen tab across channels, and has no schedule debug line", async () => {
  const api = new BrowserApi();
  api.reply("/channels", adminFixtures.channels);
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
  render(createElement(ChannelsApp, { visible: true }));
  fireEvent.click(await screen.findByRole("button", { name: "Northwoods TV" }));

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

  fireEvent.click(screen.getByRole("button", { name: "Second channel" }));
  await screen.findByRole("heading", { name: "70 · Second channel" });
  await waitFor(() =>
    expect(
      screen
        .getByRole("tab", { name: "Preview" })
        .getAttribute("aria-selected"),
    ).toBe("true"),
  );
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
    expect(api.requestsTo("/channels/one")[0]?.body).toEqual({
      number: "69",
      name: "Lakeside TV",
    }),
  );
});
