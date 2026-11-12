// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { openShortcut, renderDesktopShell } from "../testing/auth-fixtures.js";
import { BrowserApi } from "../testing/browser-api.js";
import { elapse } from "../testing/fake-time.js";
import {
  idleRoot,
  lookingUpRoot,
  mediaRoot,
  scanStatus,
} from "../testing/scan-fixtures.js";
import { bootTray } from "../testing/tray-boot.js";
import { trayIcon } from "../testing/tray-queries.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const QUIP = "It's being processed. Everything is always being processed.";

/** Everything this browser stores, so a test can prove a status adds nothing. */
function stored(): Record<string, string | null> {
  return Object.fromEntries(
    Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index)!;
      return [key, localStorage.getItem(key)];
    }),
  );
}

it("counts every running lookup on the icon, and never opens a balloon by itself", async () => {
  await bootTray({
    configured: true,
    roots: [
      lookingUpRoot("a", 300, 1000),
      lookingUpRoot("b", 40, 234, "scan"),
      // A scan still probing has nothing to look up yet; an ended job counts nothing.
      mediaRoot({
        id: "c",
        path: "/media/c",
        scan: scanStatus({ id: "job-c", rootId: "c", phase: "probing" }),
      }),
      idleRoot("d"),
    ],
  });

  const icon = await screen.findByRole("button", {
    name: "Looking up files on TMDB: 340 of 1,234",
  });
  expect(document.getElementById("tray-reminder-tip")?.textContent).toBe(
    "Looking up files on TMDB: 340 of 1,234",
  );
  expect(icon.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("opens a status balloon with the count, Gregg's quip, and only a close button", async () => {
  await bootTray({ configured: true, roots: [lookingUpRoot("a", 340, 1234)] });
  const icon = await screen.findByRole("button", {
    name: "Looking up files on TMDB: 340 of 1,234",
  });
  const focused = document.activeElement;
  const before = stored();

  fireEvent.click(icon);

  const balloon = screen.getByRole("dialog", {
    name: "Looking up files on TMDB: 340 of 1,234",
  });
  expect(within(balloon).getByRole("img", { name: "Gregg" })).toBeTruthy();
  expect(within(balloon).getByText(QUIP)).toBeTruthy();
  expect(
    within(balloon)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? button.textContent),
  ).toEqual(["Close"]);
  // Opened on request, so focus moves to its one button.
  expect(document.activeElement).not.toBe(focused);
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Close");

  fireEvent.click(within(balloon).getByRole("button", { name: "Close" }));

  expect(screen.queryByRole("dialog")).toBeNull();
  expect(trayIcon()).toBeTruthy();
  // A status is read, not answered: nothing is stored for it.
  expect(stored()).toEqual(before);
});

it("closes the status balloon on Escape without storing anything", async () => {
  await bootTray({ configured: true, roots: [lookingUpRoot("a", 1, 2)] });
  const icon = await screen.findByRole("button", {
    name: "Looking up files on TMDB: 1 of 2",
  });
  const before = stored();
  fireEvent.click(icon);

  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

  expect(screen.queryByRole("dialog")).toBeNull();
  expect(stored()).toEqual(before);
});

it("still leads with TMDB isn't set up while a lookup runs without a key", async () => {
  await bootTray({ configured: false, roots: [lookingUpRoot("a", 1, 2)] });

  expect(
    await screen.findByRole("button", { name: "TMDB isn't set up" }),
  ).toBeTruthy();
});

it("polls the media roots while a job runs, moving the count, and stops when none does", async () => {
  vi.useFakeTimers();
  const api = new BrowserApi();
  api.reply("/health", { status: "ok" });
  api.reply("/metadata/tmdb-key", { configured: true });
  api.reply("/media-roots", [lookingUpRoot("a", 10, 100)]);
  renderDesktopShell(api);
  await elapse(0);
  expect(trayIcon()?.getAttribute("aria-label")).toBe(
    "Looking up files on TMDB: 10 of 100",
  );
  const reads = () => api.requestsTo("/media-roots").length;
  const first = reads();

  api.reply("/media-roots", [lookingUpRoot("a", 60, 100)]);
  await elapse(3_000);
  expect(reads()).toBe(first + 1);
  expect(trayIcon()?.getAttribute("aria-label")).toBe(
    "Looking up files on TMDB: 60 of 100",
  );

  api.reply("/media-roots", [idleRoot("a")]);
  await elapse(3_000);
  expect(trayIcon()).toBeNull();
  const stopped = reads();

  await elapse(60_000);
  expect(reads()).toBe(stopped);
});

it("follows a running scan that has not looked anything up yet", async () => {
  vi.useFakeTimers();
  const api = new BrowserApi();
  api.reply("/health", { status: "ok" });
  api.reply("/metadata/tmdb-key", { configured: true });
  api.reply("/media-roots", [
    mediaRoot({ scan: scanStatus({ phase: "probing" }) }),
  ]);
  renderDesktopShell(api);
  await elapse(0);
  expect(trayIcon()).toBeNull();

  // The scan reaches its lookups on the next poll.
  api.reply("/media-roots", [lookingUpRoot("root", 0, 12, "scan")]);
  await elapse(3_000);

  expect(trayIcon()?.getAttribute("aria-label")).toBe(
    "Looking up files on TMDB: 0 of 12",
  );
});

it("follows the lookup a saved key starts, re-reading the roots at once", async () => {
  const api = await bootTray({ configured: false, roots: [mediaRoot()] });
  const window = openShortcut("Account Settings");
  fireEvent.click(within(window).getByRole("button", { name: "Set up TMDB" }));
  api.reply("/metadata/tmdb-key", { configured: true }, "PUT");
  api.reply("/metadata/tmdb-key", { configured: true });
  api.reply(
    "/metadata/lookup-retries",
    { lookupCount: 12, busyRootCount: 0 },
    "POST",
    202,
  );
  // What the server's roots say once the lookup has started.
  api.reply("/media-roots", [lookingUpRoot("root", 0, 12)]);
  fireEvent.change(
    await within(window).findByLabelText("API Read Access Token"),
    { target: { value: "eyJ.token.sig" } },
  );
  fireEvent.click(within(window).getByRole("button", { name: "Save" }));

  expect(
    await screen.findByRole("button", {
      name: "Looking up files on TMDB: 0 of 12",
    }),
  ).toBeTruthy();
});

it("still follows the lookup when Account Settings closes before it answers", async () => {
  const api = await bootTray({ configured: false, roots: [mediaRoot()] });
  const window = openShortcut("Account Settings");
  fireEvent.click(within(window).getByRole("button", { name: "Set up TMDB" }));
  api.reply("/metadata/tmdb-key", { configured: true }, "PUT");
  api.reply("/metadata/tmdb-key", { configured: true });
  api.hold("/metadata/lookup-retries", "POST");
  fireEvent.change(
    await within(window).findByLabelText("API Read Access Token"),
    { target: { value: "eyJ.token.sig" } },
  );
  fireEvent.click(within(window).getByRole("button", { name: "Save" }));
  await vi.waitFor(() =>
    expect(api.requestsTo("/metadata/lookup-retries")).toHaveLength(1),
  );

  // The server starts the jobs whether or not the window waits for them.
  fireEvent.click(
    screen.getByRole("button", { name: "Close Account Settings" }),
  );
  api.reply("/media-roots", [lookingUpRoot("root", 0, 12)]);
  api.release(
    "/metadata/lookup-retries",
    { lookupCount: 12, busyRootCount: 0 },
    "POST",
    202,
  );

  expect(
    await screen.findByRole("button", {
      name: "Looking up files on TMDB: 0 of 12",
    }),
  ).toBeTruthy();
});

it("still starts the lookup when Account Settings closes while the key saves", async () => {
  const api = await bootTray({ configured: false, roots: [mediaRoot()] });
  const window = openShortcut("Account Settings");
  fireEvent.click(within(window).getByRole("button", { name: "Set up TMDB" }));
  api.hold("/metadata/tmdb-key", "PUT");
  api.reply("/metadata/tmdb-key", { configured: true });
  api.reply(
    "/metadata/lookup-retries",
    { lookupCount: 12, busyRootCount: 0 },
    "POST",
    202,
  );
  fireEvent.change(
    await within(window).findByLabelText("API Read Access Token"),
    { target: { value: "eyJ.token.sig" } },
  );
  fireEvent.click(within(window).getByRole("button", { name: "Save" }));
  await vi.waitFor(() =>
    expect(
      api
        .requestsTo("/metadata/tmdb-key")
        .filter((request) => request.method === "PUT"),
    ).toHaveLength(1),
  );

  // The server keeps the key whether or not the window waits for it.
  fireEvent.click(
    screen.getByRole("button", { name: "Close Account Settings" }),
  );
  api.reply("/media-roots", [lookingUpRoot("root", 0, 12)]);
  api.release("/metadata/tmdb-key", { configured: true }, "PUT");

  expect(
    await screen.findByRole("button", {
      name: "Looking up files on TMDB: 0 of 12",
    }),
  ).toBeTruthy();
  expect(api.requestsTo("/metadata/lookup-retries")).toMatchObject([
    { method: "POST", body: { scope: "outstanding" } },
  ]);
});

it("follows the lookup Media Library starts, re-reading the roots at once", async () => {
  const root = mediaRoot({
    matchCounts: {
      items: 12,
      matched: 0,
      needsChoice: 0,
      notLookedUp: 12,
      failedLookups: 0,
    },
  });
  const api = await bootTray({ configured: true, roots: [root] });
  api.reply("/media-items", { items: [], total: 0 });
  api.reply("/metadata/match-reviews", { steps: [] });
  const retry = scanStatus({
    kind: "retry",
    phase: "enriching",
    lookupCount: 12,
  });
  api.reply("/metadata/lookup-retries", retry, "POST", 202);
  api.reply("/media-roots/root/scan", retry);
  const window = openShortcut("Media Library");
  fireEvent.click(
    await within(window).findByRole("button", { name: "Actions for /media" }),
  );
  api.reply("/media-roots", [{ ...root, scan: retry }]);
  fireEvent.click(screen.getByRole("menuitem", { name: "Look up on TMDB" }));

  expect(
    await screen.findByRole("button", {
      name: "Looking up files on TMDB: 0 of 12",
    }),
  ).toBeTruthy();
});
