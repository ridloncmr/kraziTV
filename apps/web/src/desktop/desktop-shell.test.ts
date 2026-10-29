// @vitest-environment jsdom
import { createElement } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PageRefreshScope } from "../http/resources/refresh-scope.js";
import {
  adminFixtures,
  collectionWith,
  favoritesAssignment,
} from "../testing/admin-fixtures.js";
import { account } from "../testing/auth-fixtures.js";
import { BrowserApi } from "../testing/browser-api.js";
import { serveCollection } from "../testing/collection-api.js";
import { fakeBroadcasts } from "../testing/fake-broadcasts.js";
import { DesktopShell } from "./desktop-shell.js";

// TV's player needs Media Source Extensions, which jsdom lacks.
vi.mock("../tv/broadcast-player.js", async () => {
  const { fakeBroadcasts } = await import("../testing/fake-broadcasts.js");
  return { startBroadcast: fakeBroadcasts.start };
});

afterEach(() => {
  cleanup();
  // Windows reopen where a test left them unless the memory is cleared.
  localStorage.clear();
  vi.unstubAllGlobals();
  fakeBroadcasts.reset();
});

it("navigates Start, restores one singleton and synchronizes the taskbar through close", async () => {
  const api = new BrowserApi();
  api.reply("/health", { status: "ok" });
  api.reply("/media-roots", []);
  api.reply("/media-items", { items: [], total: 0 });
  vi.stubGlobal("fetch", api.fetch);
  render(
    createElement(DesktopShell, {
      account,
      onAccountChanged: () => {},
      onLoggedOff: () => {},
    }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "start" }));
  const menu = screen.getByRole("navigation", { name: "Start programs" });
  expect(
    within(menu)
      .getByRole("link", { name: "Source code" })
      .getAttribute("href"),
  ).toBe("https://github.com/ridloncmr/kraziTV");
  fireEvent.click(within(menu).getByRole("button", { name: /Media Library/ }));
  const window = await screen.findByRole("region", { name: "Media Library" });
  fireEvent.click(
    within(window).getByRole("button", { name: "Minimize Media Library" }),
  );
  // The window stays for one beat while it shrinks toward the taskbar.
  await waitFor(() =>
    expect(screen.queryByRole("region", { name: "Media Library" })).toBeNull(),
  );
  const taskbar = screen.getByRole("navigation", { name: "Open programs" });
  expect(within(taskbar).getAllByRole("button")).toHaveLength(1);
  fireEvent.click(
    within(taskbar).getByRole("button", { name: "Media Library" }),
  );
  expect(screen.getAllByRole("region", { name: "Media Library" })).toHaveLength(
    1,
  );
  fireEvent.click(
    within(screen.getByLabelText("Desktop programs")).getByRole("button", {
      name: "Media Library",
    }),
  );
  expect(within(taskbar).getAllByRole("button")).toHaveLength(1);
  fireEvent.click(
    within(window).getByRole("button", { name: "Maximize Media Library" }),
  );
  expect(window.className).toContain("maximized");
  fireEvent.click(
    within(window).getByRole("button", { name: "Restore Media Library" }),
  );
  expect(window.className).not.toContain("maximized");
  fireEvent.click(
    within(window).getByRole("button", { name: "Close Media Library" }),
  );
  expect(within(taskbar).queryAllByRole("button")).toHaveLength(0);
});

it("reaches an offline desktop and dismisses Start with keyboard focus restored", async () => {
  const api = new BrowserApi();
  api.reply(
    "/health",
    { error: { code: "offline", message: "Unavailable" } },
    "GET",
    503,
  );
  vi.stubGlobal("fetch", api.fetch);
  render(
    createElement(DesktopShell, {
      account,
      onAccountChanged: () => {},
      onLoggedOff: () => {},
    }),
  );
  const start = await screen.findByRole("button", { name: "start" });
  fireEvent.click(start);
  await waitFor(() =>
    expect(document.activeElement?.textContent).toContain("My Channels"),
  );
  fireEvent.keyDown(document, { key: "Escape" });
  expect(
    screen.queryByRole("navigation", { name: "Start programs" }),
  ).toBeNull();
  expect(document.activeElement).toBe(start);
  expect(
    await screen.findByRole("button", { name: "Can't reach kraziTV" }),
  ).toBeTruthy();
});

it("keeps windows on screen while the browser shrinks and restores their places when it grows", async () => {
  const api = new BrowserApi();
  api.reply("/health", { status: "ok" });
  api.reply("/media-roots", []);
  api.reply("/media-items", { items: [], total: 0 });
  vi.stubGlobal("fetch", api.fetch);
  vi.stubGlobal("innerWidth", 1280);
  vi.stubGlobal("innerHeight", 800);
  render(
    createElement(DesktopShell, {
      account,
      onAccountChanged: () => {},
      onLoggedOff: () => {},
    }),
  );
  const shortcuts = await screen.findByLabelText("Desktop programs");
  fireEvent.click(
    within(shortcuts).getByRole("button", { name: "Media Library" }),
  );
  const media = screen.getByRole("region", { name: "Media Library" });
  const title = within(media).getByLabelText(/Media Library window/);
  for (let step = 0; step < 10; step++)
    fireEvent.keyDown(title, { key: "ArrowRight" });
  const placed = { left: media.style.left, top: media.style.top };
  expect(placed).toEqual({ left: "340px", top: "40px" });
  /** Simulates dragging the browser between monitors of different sizes. */
  const resizeTo = (width: number, height: number) =>
    act(() => {
      vi.stubGlobal("innerWidth", width);
      vi.stubGlobal("innerHeight", height);
      globalThis.dispatchEvent(new Event("resize"));
    });
  resizeTo(800, 600);
  expect({ left: media.style.left, top: media.style.top }).toEqual({
    left: "40px",
    top: "28px",
  });
  resizeTo(1280, 800);
  expect({ left: media.style.left, top: media.style.top }).toEqual(placed);
});

it("focuses inactive windows by pointer and moves the focused title with the keyboard", async () => {
  const api = new BrowserApi();
  api.reply("/health", { status: "ok" });
  api.reply("/media-roots", []);
  api.reply("/media-items", { items: [], total: 0 });
  api.reply("/media-collections", []);
  vi.stubGlobal("fetch", api.fetch);
  vi.stubGlobal("innerWidth", 1280);
  vi.stubGlobal("innerHeight", 800);
  render(
    createElement(DesktopShell, {
      account,
      onAccountChanged: () => {},
      onLoggedOff: () => {},
    }),
  );
  const shortcuts = await screen.findByLabelText("Desktop programs");
  fireEvent.click(
    within(shortcuts).getByRole("button", { name: "Media Library" }),
  );
  fireEvent.click(
    within(shortcuts).getByRole("button", { name: "Collections" }),
  );
  const media = screen.getByRole("region", { name: "Media Library" });
  const taskbar = screen.getByRole("navigation", { name: "Open programs" });
  const openedButtons = within(taskbar)
    .getAllByRole("button")
    .map((button) => button.textContent);
  const domOrder = () =>
    screen.getAllByRole("region").map((region) => region.ariaLabel);
  const openedRegions = domOrder();
  expect(media.className).toContain("inactive");
  fireEvent.pointerDown(media);
  expect(media.className).toContain("active");
  // Browsers drop a click whose pressed node moves, so focus restacks by z-index only.
  expect(domOrder()).toEqual(openedRegions);
  expect(Number(media.style.zIndex)).toBe(2);
  expect(
    within(taskbar)
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toEqual(openedButtons);
  const title = within(media).getByLabelText(/Media Library window/);
  const before = Number.parseFloat(media.style.left);
  fireEvent.keyDown(title, { key: "ArrowRight" });
  expect(Number.parseFloat(media.style.left)).toBeGreaterThan(before);
});

it("resizes by grip and keyboard within the space below and right of the window", async () => {
  const api = new BrowserApi();
  api.reply("/health", { status: "ok" });
  api.reply("/media-roots", []);
  api.reply("/media-items", { items: [], total: 0 });
  vi.stubGlobal("fetch", api.fetch);
  vi.stubGlobal("innerWidth", 1280);
  vi.stubGlobal("innerHeight", 800);
  render(
    createElement(DesktopShell, {
      account,
      onAccountChanged: () => {},
      onLoggedOff: () => {},
    }),
  );
  const shortcuts = await screen.findByLabelText("Desktop programs");
  fireEvent.click(
    within(shortcuts).getByRole("button", { name: "Media Library" }),
  );
  const media = screen.getByRole("region", { name: "Media Library" });
  const size = () => ({ width: media.style.width, height: media.style.height });
  expect(size()).toEqual({ width: "760px", height: "540px" });
  // jsdom implements no pointer capture; the browser keeps the grip tracking off-element.
  const grip = Object.assign(media.querySelector(".resize-grip")!, {
    setPointerCapture: vi.fn(),
  });
  fireEvent.pointerDown(grip, { button: 0, clientX: 900, clientY: 580 });
  fireEvent.pointerMove(grip, { clientX: 1000, clientY: 500 });
  fireEvent.pointerUp(grip);
  expect(size()).toEqual({ width: "860px", height: "460px" });
  // The window sits at 140,40 in a 1280x768 desktop, so growth stops at the edges.
  fireEvent.pointerDown(grip, { button: 0, clientX: 0, clientY: 0 });
  fireEvent.pointerMove(grip, { clientX: 2000, clientY: 2000 });
  fireEvent.pointerUp(grip);
  expect(size()).toEqual({ width: "1140px", height: "728px" });
  const title = within(media).getByLabelText(/Media Library window/);
  for (let step = 0; step < 50; step++)
    fireEvent.keyDown(title, { key: "ArrowLeft", shiftKey: true });
  expect(size()).toEqual({ width: "360px", height: "728px" });
  expect(media.style.left).toBe("140px");
});

it("reloads a window brought to the front, and every open window when the browser regains focus", async () => {
  const api = new BrowserApi();
  api.reply("/health", { status: "ok" });
  api.reply("/media-roots", []);
  api.reply("/media-items", { items: [], total: 0 });
  api.reply("/metadata/match-reviews", { steps: [] });
  api.reply("/plex/setup", {});
  vi.stubGlobal("fetch", api.fetch);
  render(
    createElement(
      PageRefreshScope,
      null,
      createElement(DesktopShell, {
        account,
        onAccountChanged: () => {},
        onLoggedOff: () => {},
      }),
    ),
  );
  const shortcuts = await screen.findByLabelText("Desktop programs");
  fireEvent.click(
    within(shortcuts).getByRole("button", { name: "Plex Setup" }),
  );
  await waitFor(() => expect(api.requestsTo("/plex/setup")).toHaveLength(1));
  fireEvent.click(
    within(shortcuts).getByRole("button", { name: "Media Library" }),
  );
  await screen.findByRole("region", { name: "Media Library" });

  fireEvent.pointerDown(screen.getByRole("region", { name: "Plex Setup" }));
  await waitFor(() => expect(api.requestsTo("/plex/setup")).toHaveLength(2));

  act(() => {
    globalThis.dispatchEvent(new Event("blur"));
    globalThis.dispatchEvent(new Event("focus"));
  });
  await waitFor(() => expect(api.requestsTo("/plex/setup")).toHaveLength(3));
});

it("opens each channel in its own Channel Properties beside My Channels, follows a rename, and closes one when its channel is deleted", async () => {
  const [northwoods, second] = adminFixtures.channels;
  const api = new BrowserApi();
  api.reply("/health", { status: "ok" });
  api.reply("/media-roots", []);
  api.reply("/channels", adminFixtures.channels);
  api.reply("/channels/one", northwoods);
  api.reply("/channels/two", second);
  api.reply("/channels/one/programming-assignments", []);
  api.reply("/channels/two/programming-assignments", []);
  api.reply("/media-collections", []);
  vi.stubGlobal("fetch", api.fetch);
  vi.stubGlobal("innerWidth", 1280);
  vi.stubGlobal("innerHeight", 800);
  render(
    createElement(DesktopShell, {
      account,
      onAccountChanged: () => {},
      onLoggedOff: () => {},
    }),
  );
  fireEvent.click(
    within(screen.getByLabelText("Desktop programs")).getByRole("button", {
      name: "My Channels",
    }),
  );
  const list = await screen.findByRole("region", { name: "My Channels" });
  // The row menu's Properties opens it.
  fireEvent.click(
    await within(list).findByRole("button", {
      name: "Actions for Northwoods TV",
    }),
  );
  fireEvent.click(screen.getByRole("menuitem", { name: "Properties" }));
  const properties = await screen.findByRole("region", {
    name: "Northwoods TV Properties",
  });
  // It opens to the right of My Channels, so neither hides the other.
  expect(parseFloat(properties.style.left)).toBeGreaterThanOrEqual(
    parseFloat(list.style.left) + parseFloat(list.style.width),
  );
  const taskbar = screen.getByRole("navigation", { name: "Open programs" });
  expect(
    within(taskbar)
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toEqual(["My Channels", "Northwoods TV Properties"]);

  // Another channel, here by double-click, opens in a window of its own a
  // step past the first; opening the first again only brings it forward.
  fireEvent.doubleClick(
    within(list).getByRole("button", { name: "Second channel" }),
  );
  const secondWindow = await screen.findByRole("region", {
    name: "Second channel Properties",
  });
  // Measured downward: at 1280px the step right meets the screen's edge.
  expect(parseFloat(secondWindow.style.top)).toBe(
    parseFloat(properties.style.top) + 24,
  );
  fireEvent.doubleClick(
    within(list).getByRole("button", { name: "Northwoods TV" }),
  );
  expect(
    within(taskbar)
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toEqual([
    "My Channels",
    "Northwoods TV Properties",
    "Second channel Properties",
  ]);
  expect(
    within(taskbar)
      .getByRole("button", { name: "Northwoods TV Properties" })
      .getAttribute("aria-pressed"),
  ).toBe("true");

  // A rename there retitles the window and redraws the list.
  const renamed = { ...second, name: "Lakeside TV" };
  api.reply("/channels/two", renamed, "PATCH");
  api.reply("/channels/two", renamed);
  api.reply("/channels", [northwoods, renamed]);
  const sheet = screen.getByRole("region", {
    name: "Second channel Properties",
  });
  // An empty lineup opens on Lineup first.
  await within(sheet).findByText(/No shows yet/);
  fireEvent.click(within(sheet).getByRole("tab", { name: "General" }));
  fireEvent.change(within(sheet).getByLabelText("Name"), {
    target: { value: "Lakeside TV" },
  });
  fireEvent.click(within(sheet).getByRole("button", { name: "Apply" }));
  await screen.findByRole("region", { name: "Lakeside TV Properties" });
  await within(list).findByRole("button", { name: "Lakeside TV" });

  // Deleting a channel closes its window and leaves the others open.
  api.reply("/channels/two", undefined, "DELETE", 204);
  api.reply("/channels", [northwoods]);
  fireEvent.click(within(list).getByRole("button", { name: "Lakeside TV" }));
  fireEvent.click(within(list).getByRole("button", { name: "Delete…" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Delete channel permanently" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("region", { name: "Lakeside TV Properties" }),
    ).toBeNull(),
  );
  expect(
    screen.getByRole("region", { name: "Northwoods TV Properties" }),
  ).toBeTruthy();
});

it("opens a collection in its own Collection Properties, and asks before closing it with unsaved changes", async () => {
  const favorites = collectionWith("favorites", "Favorites", {
    memberCount: 2,
  });
  const api = new BrowserApi();
  api.reply("/health", { status: "ok" });
  api.reply("/media-roots", []);
  api.reply("/media-collections", [favorites]);
  api.reply("/media-collections/favorites", favorites);
  serveCollection(api, "favorites", ["z", "a"]);
  vi.stubGlobal("fetch", api.fetch);
  vi.stubGlobal("innerWidth", 1280);
  vi.stubGlobal("innerHeight", 800);
  render(
    createElement(DesktopShell, {
      account,
      onAccountChanged: () => {},
      onLoggedOff: () => {},
    }),
  );
  fireEvent.click(
    within(screen.getByLabelText("Desktop programs")).getByRole("button", {
      name: "Collections",
    }),
  );
  const grid = await screen.findByRole("region", { name: "Collections" });
  fireEvent.click(
    await within(grid).findByRole("button", { name: "Open Favorites" }),
  );
  const window = await screen.findByRole("region", {
    name: "Favorites Properties",
  });
  // It opens to the right of Collections, which keeps its grid.
  expect(parseFloat(window.style.left)).toBeGreaterThanOrEqual(
    parseFloat(grid.style.left) + parseFloat(grid.style.width),
  );

  fireEvent.click(await within(window).findByLabelText("Select member Zulu"));
  fireEvent.click(within(window).getByRole("button", { name: "Move to top" }));
  fireEvent.click(
    within(window).getByRole("button", { name: "Close Favorites Properties" }),
  );
  const confirm = within(window).getByRole("dialog", {
    name: "Unsaved changes",
  });
  expect(confirm.textContent).toContain(
    "Discard your unsaved changes to Favorites?",
  );
  fireEvent.click(
    within(confirm).getByRole("button", { name: "Keep editing" }),
  );
  expect(
    screen.getByRole("region", { name: "Favorites Properties" }),
  ).toBeTruthy();

  fireEvent.click(
    within(window).getByRole("button", { name: "Close Favorites Properties" }),
  );
  fireEvent.click(
    within(
      within(window).getByRole("dialog", { name: "Unsaved changes" }),
    ).getByRole("button", { name: "Discard changes" }),
  );
  expect(
    screen.queryByRole("region", { name: "Favorites Properties" }),
  ).toBeNull();
  // Nothing was saved.
  expect(api.requests.some((request) => request.method === "PUT")).toBe(false);
});

it("asks before closing a Channel Properties window whose open show has unsaved changes, and not once they are applied", async () => {
  const assignments = "/channels/one/programming-assignments";
  const api = new BrowserApi();
  api.reply("/health", { status: "ok" });
  api.reply("/media-roots", []);
  api.reply("/channels", [adminFixtures.channels[0]]);
  api.reply("/channels/one", adminFixtures.channels[0]);
  api.reply(assignments, [favoritesAssignment("chronological")]);
  api.reply("/media-collections", adminFixtures.collections);
  api.handle(
    `${assignments}/assignment`,
    () => {
      const saved = favoritesAssignment("random");
      api.reply(assignments, [saved]);
      return api.response(saved);
    },
    "PATCH",
  );
  vi.stubGlobal("fetch", api.fetch);
  render(
    createElement(DesktopShell, {
      account,
      onAccountChanged: () => {},
      onLoggedOff: () => {},
    }),
  );
  fireEvent.click(
    within(screen.getByLabelText("Desktop programs")).getByRole("button", {
      name: "My Channels",
    }),
  );
  const list = await screen.findByRole("region", { name: "My Channels" });
  fireEvent.doubleClick(
    await within(list).findByRole("button", { name: "Northwoods TV" }),
  );
  const window = await screen.findByRole("region", {
    name: "Northwoods TV Properties",
  });
  fireEvent.click(await within(window).findByRole("tab", { name: "Lineup" }));
  fireEvent.doubleClick(
    await within(window).findByRole("button", { name: "Favorites" }),
  );
  const show = within(window).getByRole("dialog", { name: "Favorites" });
  fireEvent.change(within(show).getByLabelText("Play order"), {
    target: { value: "random" },
  });
  const close = () =>
    fireEvent.click(
      within(window).getByRole("button", {
        name: "Close Northwoods TV Properties",
      }),
    );

  close();
  const confirm = within(window).getByRole("dialog", {
    name: "Unsaved changes",
  });
  expect(confirm.textContent).toContain(
    "Discard your unsaved changes to Northwoods TV?",
  );
  fireEvent.click(
    within(confirm).getByRole("button", { name: "Keep editing" }),
  );
  // The show still holds the edit.
  expect(
    within(show).getByLabelText<HTMLSelectElement>("Play order").value,
  ).toBe("random");

  // Apply leaves the show open; once its save lands, which the lineup
  // reading again shows, nothing is unsaved.
  const reads = api.requestsTo(assignments).length;
  fireEvent.click(within(show).getByRole("button", { name: "Apply" }));
  await waitFor(() =>
    expect(api.requestsTo(assignments).length).toBeGreaterThan(reads),
  );
  close();
  expect(
    screen.queryByRole("region", { name: "Northwoods TV Properties" }),
  ).toBeNull();
});

it.each([
  {
    tab: "General",
    edit: async (window: HTMLElement) =>
      fireEvent.change(await within(window).findByLabelText("Name"), {
        target: { value: "Northwoods Two" },
      }),
  },
  {
    tab: "Rules",
    edit: async (window: HTMLElement) => {
      fireEvent.click(
        await within(window).findByRole("button", { name: "New rule…" }),
      );
      const rule = within(window).getByRole("dialog", { name: "New rule" });
      fireEvent.change(within(rule).getByLabelText("Name"), {
        target: { value: "Weekends" },
      });
    },
  },
  {
    tab: "Specials",
    edit: async (window: HTMLElement) => {
      fireEvent.click(
        await within(window).findByRole("button", { name: "New special…" }),
      );
      fireEvent.change(within(window).getByLabelText("Starts"), {
        target: { value: "2026-12-24T20:00" },
      });
    },
  },
])(
  "asks before closing a Channel Properties window with an unsaved edit on its $tab tab",
  async ({ tab, edit }) => {
    const api = new BrowserApi();
    api.reply("/health", { status: "ok" });
    api.reply("/media-roots", []);
    api.reply("/channels", [adminFixtures.channels[0]]);
    api.reply("/channels/one", adminFixtures.channels[0]);
    api.reply("/channels/one/programming-assignments", [
      favoritesAssignment("chronological"),
    ]);
    api.reply("/channels/one/programming-rules", []);
    api.reply("/channels/one/reservations", []);
    api.reply("/programming-timezone", { programmingTimezone: "UTC" });
    api.reply("/media-collections", adminFixtures.collections);
    api.reply("/media-items", { items: adminFixtures.media, total: 2 });
    vi.stubGlobal("fetch", api.fetch);
    render(
      createElement(DesktopShell, {
        account,
        onAccountChanged: () => {},
        onLoggedOff: () => {},
      }),
    );
    fireEvent.click(
      within(screen.getByLabelText("Desktop programs")).getByRole("button", {
        name: "My Channels",
      }),
    );
    const list = await screen.findByRole("region", { name: "My Channels" });
    fireEvent.doubleClick(
      await within(list).findByRole("button", { name: "Northwoods TV" }),
    );
    const window = await screen.findByRole("region", {
      name: "Northwoods TV Properties",
    });
    fireEvent.click(await within(window).findByRole("tab", { name: tab }));
    await edit(window);

    fireEvent.click(
      within(window).getByRole("button", {
        name: "Close Northwoods TV Properties",
      }),
    );
    expect(
      within(window).getByRole("dialog", { name: "Unsaved changes" })
        .textContent,
    ).toContain("Discard your unsaved changes to Northwoods TV?");
  },
);

it("closes a Channel Properties window from General's OK once it saves, and from Cancel", async () => {
  const api = new BrowserApi();
  const northwoods = adminFixtures.channels[0];
  api.reply("/health", { status: "ok" });
  api.reply("/media-roots", []);
  api.reply("/channels", [northwoods]);
  api.reply("/channels/one", northwoods);
  api.reply("/channels/one", { ...northwoods, number: "70" }, "PATCH");
  api.reply("/channels/one/programming-assignments", [
    favoritesAssignment("chronological"),
  ]);
  api.reply("/media-collections", adminFixtures.collections);
  vi.stubGlobal("fetch", api.fetch);
  render(
    createElement(DesktopShell, {
      account,
      onAccountChanged: () => {},
      onLoggedOff: () => {},
    }),
  );
  fireEvent.click(
    within(screen.getByLabelText("Desktop programs")).getByRole("button", {
      name: "My Channels",
    }),
  );
  const list = await screen.findByRole("region", { name: "My Channels" });
  // Opens the channel's window on General.
  const openGeneral = async () => {
    fireEvent.doubleClick(
      await within(list).findByRole("button", { name: "Northwoods TV" }),
    );
    const window = await screen.findByRole("region", {
      name: "Northwoods TV Properties",
    });
    fireEvent.click(
      await within(window).findByRole("tab", { name: "General" }),
    );
    return window;
  };

  const window = await openGeneral();
  fireEvent.change(within(window).getByLabelText("Number"), {
    target: { value: "70" },
  });
  fireEvent.click(within(window).getByRole("button", { name: "OK" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("region", { name: "Northwoods TV Properties" }),
    ).toBeNull(),
  );
  // Saving closed it without asking.
  expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).toBeNull();

  fireEvent.click(
    within(await openGeneral()).getByRole("button", { name: "Cancel" }),
  );
  expect(
    screen.queryByRole("region", { name: "Northwoods TV Properties" }),
  ).toBeNull();
});

it("opens TV on the channel Watch names, and retunes an open TV", async () => {
  const api = new BrowserApi();
  api.reply("/health", { status: "ok" });
  api.reply("/media-roots", []);
  api.reply("/metadata/tmdb-key", { configured: true });
  api.reply("/channels", adminFixtures.channels);
  api.reply("/channels/one/now", adminFixtures.now);
  api.reply("/channels/two/now", adminFixtures.now);
  vi.stubGlobal("fetch", api.fetch);
  render(
    createElement(DesktopShell, {
      account,
      onAccountChanged: () => {},
      onLoggedOff: () => {},
    }),
  );
  const shortcuts = screen.getByLabelText("Desktop programs");
  fireEvent.click(
    within(shortcuts).getByRole("button", { name: "My Channels" }),
  );
  const channels = await screen.findByRole("region", { name: "My Channels" });
  const watch = async (name: string) => {
    fireEvent.click(await within(channels).findByRole("button", { name }));
    fireEvent.click(within(channels).getByRole("button", { name: "Watch" }));
  };

  await watch("Second channel");
  const tv = await screen.findByRole("region", { name: "TV" });
  await waitFor(() =>
    expect(
      within(tv).getByRole<HTMLSelectElement>("combobox", { name: "Channel" })
        .value,
    ).toBe("two"),
  );
  await watch("Northwoods TV");
  await waitFor(() =>
    expect(new URL(fakeBroadcasts.latest!.url).pathname).toBe(
      "/channels/one/stream",
    ),
  );
});
