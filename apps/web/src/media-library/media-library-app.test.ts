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
import { WindowDialogFrame } from "../controls/window-dialog.js";
import type { FolderListing, MediaRoot } from "../http/contracts.js";
import { adminFixtures } from "../testing/admin-fixtures.js";
import { BrowserApi } from "../testing/browser-api.js";
import { mediaRoot, scanStatus } from "../testing/scan-fixtures.js";
import { MediaLibraryApp } from "./media-library-app.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("pages the catalog on the server and restarts at the first page for a new search", async () => {
  const api = new BrowserApi();
  api.reply("/media-roots", []);
  api.handle("/media-items", ({ query }) =>
    api.response({
      items: [{ ...adminFixtures.media[0], id: `at-${query.get("offset")}` }],
      total: 120,
    }),
  );
  vi.stubGlobal("fetch", api.fetch);
  const lastQuery = () =>
    api.requests.filter((request) => request.path === "/media-items").at(-1)
      ?.query;
  render(createElement(MediaLibraryApp, { visible: true }));

  await screen.findByText("1–50 of 120");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("51–100 of 120");
  expect(lastQuery()?.get("offset")).toBe("50");
  expect(lastQuery()?.get("limit")).toBe("50");

  fireEvent.change(screen.getByLabelText("Find media"), {
    target: { value: "  pilot " },
  });
  await waitFor(() => expect(lastQuery()?.get("q")).toBe("pilot"));
  expect(lastQuery()?.get("offset")).toBe("0");
});

it("keeps the current rows on screen while the next page loads", async () => {
  const api = new BrowserApi();
  api.reply("/media-roots", []);
  api.reply("/media-items", { items: [adminFixtures.media[0]], total: 120 });
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(MediaLibraryApp, { visible: true }));
  await screen.findByText("Alpha");

  api.hold("/media-items");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("51–100 of 120");
  expect(screen.getByText("Alpha")).toBeTruthy();

  await act(async () => {
    api.release("/media-items", {
      items: [adminFixtures.media[1]],
      total: 120,
    });
  });
  expect(screen.getByText("Zulu")).toBeTruthy();
  expect(screen.queryByText("Alpha")).toBeNull();
});

it("keeps a rejected path in its dialog, then lists the added root", async () => {
  const api = new BrowserApi();
  api.reply("/media-roots", []);
  api.reply("/media-items", { items: [], total: 0 });
  api.reply(
    "/media-roots",
    { error: { code: "invalid_path", message: "Path is not a directory" } },
    "POST",
    400,
  );
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(MediaLibraryApp, { visible: true }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Add a media root…" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Add media root" });
  fireEvent.change(screen.getByLabelText("Absolute server path"), {
    target: { value: "/media" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add root" }));
  expect(
    (await screen.findByText("Path is not a directory")).closest(
      '[role="dialog"]',
    ),
  ).toBe(dialog);

  const root = {
    id: "root",
    path: "/media",
    enabled: true,
    lastScannedAt: null,
  };
  api.reply("/media-roots", root, "POST");
  api.reply("/media-roots", [root]);
  fireEvent.click(screen.getByRole("button", { name: "Add root" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await screen.findByRole("button", { name: "Scan" });
  expect(
    api.requests.find((request) => request.method === "POST")?.body,
  ).toEqual({ path: "/media" });
});

it("fills the path by browsing server folders from the typed path", async () => {
  const api = new BrowserApi();
  api.reply("/media-roots", []);
  api.reply("/media-items", { items: [], total: 0 });
  const listings: Record<string, FolderListing> = {
    "": {
      path: null,
      parent: null,
      folders: [{ name: "D:\\", path: "D:\\" }],
    },
    "D:\\": {
      path: "D:\\",
      parent: null,
      folders: [{ name: "TV", path: "D:\\TV" }],
    },
    "D:\\TV": { path: "D:\\TV", parent: "D:\\", folders: [] },
  };
  api.handle("/media-roots/folders", ({ query }) =>
    api.response(listings[query.get("path") ?? ""]),
  );
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(MediaLibraryApp, { visible: true }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Add a media root…" }),
  );
  const field = screen.getByLabelText<HTMLInputElement>("Absolute server path");
  fireEvent.change(field, { target: { value: "D:\\" } });

  fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
  const browser = screen.getByRole("group", { name: "Server folders" });
  fireEvent.click(await within(browser).findByRole("button", { name: "TV" }));
  await within(browser).findByText("No folders here.");
  expect(field.value).toBe("D:\\TV");

  fireEvent.click(within(browser).getByRole("button", { name: "Up" }));
  await within(browser).findByRole("button", { name: "TV" });
  fireEvent.click(within(browser).getByRole("button", { name: "Up" }));
  await within(browser).findByText("This server");
  expect(field.value).toBe("D:\\");
});

const SCAN_PATH = "/media-roots/root/scan";

/**
 * A Media Library in a window frame beside an unrelated control, on fake
 * timers so each one-second poll is driven explicitly. The scan route answers
 * with whatever `scan.status` holds at each poll.
 */
function renderScanLibrary(roots: MediaRoot[], first = scanStatus()) {
  vi.useFakeTimers();
  const api = new BrowserApi();
  const scan = { status: first };
  api.reply("/media-roots", roots);
  api.reply("/media-items", { items: [], total: 0 });
  api.reply(SCAN_PATH, first, "POST", 202);
  api.handle(SCAN_PATH, () => api.response(scan.status));
  vi.stubGlobal("fetch", api.fetch);
  const tree = (visible: boolean) =>
    createElement(
      "div",
      null,
      createElement("button", null, "Other window"),
      createElement(
        WindowDialogFrame,
        null,
        createElement(MediaLibraryApp, { visible }),
      ),
    );
  const view = render(tree(true));
  return {
    api,
    scan,
    setVisible: (visible: boolean) => view.rerender(tree(visible)),
    count: (path: string, method = "GET") =>
      api.requests.filter(
        (request) => request.path === path && request.method === method,
      ).length,
  };
}

/** Runs timers and the fetches they start, as that much wall clock would. */
async function advance(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

/** Starts a scan of the only root and returns its progress dialog. */
async function startScan() {
  await advance();
  fireEvent.click(screen.getByRole("button", { name: "Scan" }));
  await advance();
  return screen.getByRole("dialog", { name: "Scanning media root" });
}

/** The dialog's polite live region, which announces phase changes only. */
function statusLine(dialog: HTMLElement) {
  return within(dialog).getByRole("status");
}

it("opens the progress dialog on start and locks only the Media Library window", async () => {
  renderScanLibrary(
    [mediaRoot()],
    scanStatus({ phase: "discovering", discoveredCount: 812 }),
  );
  const dialog = await startScan();

  expect(statusLine(dialog).textContent).toBe(
    "Looking for media files in /media…",
  );
  expect(within(dialog).getByText("812 found")).toBeTruthy();
  const bar = within(dialog).getByRole("progressbar");
  expect(bar.hasAttribute("aria-valuenow")).toBe(false);
  const content = document.querySelector(".window-content")!;
  expect(content.hasAttribute("inert")).toBe(true);
  expect(
    screen.getByRole("button", { name: "Other window" }).closest("[inert]"),
  ).toBeNull();

  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(
    within(dialog)
      .getByRole("button", { name: "Close Scanning media root" })
      .matches(":disabled"),
  ).toBe(true);
  expect(screen.getByRole("dialog", { name: "Scanning media root" })).toBe(
    dialog,
  );
  expect(screen.queryByText("Operation completed successfully.")).toBeNull();
  expect(screen.queryByText(/Scan started/)).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("shows probing as a determinate bar and committing as indeterminate", async () => {
  const { scan } = renderScanLibrary([mediaRoot()]);
  const dialog = await startScan();

  scan.status = scanStatus({ phase: "probing" });
  await advance(1_000);
  const bar = within(dialog).getByRole("progressbar");
  expect(bar.getAttribute("aria-valuemax")).toBe("1");
  expect(bar.getAttribute("aria-valuenow")).toBe("0");

  scan.status = scanStatus({
    phase: "probing",
    discoveredCount: 3_880,
    settledCount: 1_204,
    currentPath: "/media/show/Pilot.mkv",
  });
  await advance(1_000);
  expect(statusLine(dialog).textContent).toBe("Probing media files…");
  expect(within(dialog).getByText("Last probed: Pilot.mkv")).toBeTruthy();
  expect(within(dialog).getByText("1,204 of 3,880 files")).toBeTruthy();
  expect(bar.getAttribute("aria-valuemin")).toBe("0");
  expect(bar.getAttribute("aria-valuemax")).toBe("3880");
  expect(bar.getAttribute("aria-valuenow")).toBe("1204");

  scan.status = scanStatus({
    phase: "committing",
    discoveredCount: 3_880,
    settledCount: 3_880,
  });
  await advance(1_000);
  expect(statusLine(dialog).textContent).toBe("Saving to the catalog…");
  expect(within(dialog).getByText("3,880 found")).toBeTruthy();
  expect(
    within(dialog).getByRole("progressbar").hasAttribute("aria-valuenow"),
  ).toBe(false);
});

it("animates the decorative paper only while discovering or probing", async () => {
  const { scan } = renderScanLibrary([mediaRoot()]);
  const dialog = await startScan();
  /** The paper animation; the stylesheet moves it only while it is animating. */
  const animation = () => dialog.querySelector("svg.scan-animation");
  expect(animation()?.getAttribute("aria-hidden")).toBe("true");
  expect(animation()?.classList.contains("animating")).toBe(true);

  scan.status = scanStatus({ phase: "probing", discoveredCount: 3 });
  await advance(1_000);
  expect(animation()?.classList.contains("animating")).toBe(true);

  scan.status = scanStatus({ phase: "committing", discoveredCount: 3 });
  await advance(1_000);
  expect(animation()?.classList.contains("animating")).toBe(false);

  scan.status = scanStatus({
    phase: "completed",
    summary: {
      discoveredCount: 3,
      probedCount: 3,
      probeFailedCount: 0,
      missingCount: 0,
    },
  });
  await advance(1_000);
  expect(animation()).not.toBeNull();
  expect(animation()?.classList.contains("animating")).toBe(false);
});

it("cancels the scan, reads Cancelling… until the outcome, keeps focus in the dialog, and OK refreshes", async () => {
  const { api, scan, count } = renderScanLibrary(
    [mediaRoot()],
    scanStatus({ phase: "probing", discoveredCount: 10 }),
  );
  api.handle(
    SCAN_PATH,
    () => {
      scan.status = { ...scan.status, cancelRequested: true };
      return api.response(scan.status, 202);
    },
    "DELETE",
  );
  const dialog = await startScan();

  const cancel = within(dialog).getByRole("button", { name: "Cancel" });
  cancel.focus();
  fireEvent.click(cancel);
  await advance();
  expect(count(SCAN_PATH, "DELETE")).toBe(1);
  // The disabled button cannot hold focus, so the dialog panel takes it.
  expect(document.activeElement).toBe(dialog);
  const cancelling = within(dialog).getByRole("button", {
    name: "Cancelling…",
  });
  expect(cancelling.matches(":disabled")).toBe(true);
  await advance(1_000);
  expect(within(dialog).getByRole("button", { name: "Cancelling…" })).toBe(
    cancelling,
  );

  scan.status = scanStatus({
    phase: "cancelled",
    discoveredCount: 10,
    cancelRequested: true,
  });
  await advance(1_000);
  expect(statusLine(dialog).textContent).toBe(
    "Scan cancelled. The catalog is unchanged.",
  );
  expect(within(dialog).queryByRole("progressbar")).toBeNull();
  expect(document.activeElement).toBe(
    within(dialog).getByRole("button", { name: "OK" }),
  );
  const roots = count("/media-roots");
  const media = count("/media-items");
  fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
  await advance();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(count("/media-roots")).toBe(roots + 1);
  expect(count("/media-items")).toBe(media + 1);
});

it("disables Cancel without claiming Cancelling… while the scan commits", async () => {
  const { scan } = renderScanLibrary([mediaRoot()]);
  const dialog = await startScan();
  scan.status = scanStatus({ phase: "committing", discoveredCount: 3 });
  await advance(1_000);

  const cancel = within(dialog).getByRole("button", { name: "Cancel" });
  expect(cancel.matches(":disabled")).toBe(true);
});

it("reads Cancel again when the server ignores a cancel because the commit started", async () => {
  const { api, scan } = renderScanLibrary(
    [mediaRoot()],
    scanStatus({ phase: "probing", discoveredCount: 3 }),
  );
  api.handle(
    SCAN_PATH,
    () => {
      // The commit began before the request arrived, so the server ignores it.
      scan.status = scanStatus({ phase: "committing", discoveredCount: 3 });
      return api.response(scan.status, 202);
    },
    "DELETE",
  );
  const dialog = await startScan();

  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await advance();
  const cancel = within(dialog).getByRole("button", { name: "Cancel" });
  expect(cancel.matches(":disabled")).toBe(true);
  expect(within(dialog).queryByRole("button", { name: "Cancelling…" })).toBe(
    null,
  );
});

it("shows Cancelling… when the server reports another client's cancel", async () => {
  const { scan } = renderScanLibrary([mediaRoot()]);
  const dialog = await startScan();
  scan.status = scanStatus({ cancelRequested: true });
  await advance(1_000);
  expect(
    within(dialog)
      .getByRole("button", { name: "Cancelling…" })
      .matches(":disabled"),
  ).toBe(true);
});

it.each([
  {
    outcome: scanStatus({
      phase: "completed",
      summary: {
        discoveredCount: 7,
        probedCount: 5,
        probeFailedCount: 2,
        missingCount: 3,
      },
    }),
    line: "Scan completed.",
    facts: ["Discovered 7", "Probed 5", "Probe failures 2", "Missing 3"],
    note: null,
  },
  {
    outcome: scanStatus({
      phase: "failed",
      error: {
        code: "media_root_unavailable",
        message: "Media root /media is unavailable",
      },
    }),
    line: "Media root /media is unavailable",
    facts: [],
    note: "The catalog is unchanged.",
  },
])(
  "shows the $outcome.phase outcome with an OK that refreshes roots and catalog",
  async ({ outcome, line, facts, note }) => {
    const { scan, count } = renderScanLibrary([mediaRoot()]);
    const dialog = await startScan();
    scan.status = outcome;
    await advance(1_000);

    expect(statusLine(dialog).textContent).toBe(line);
    const shown = [...dialog.querySelectorAll(".facts dt")].map(
      (term) => `${term.textContent} ${term.nextElementSibling?.textContent}`,
    );
    expect(shown).toEqual(facts);
    expect(
      within(dialog).queryByText("The catalog is unchanged.")?.textContent ??
        null,
    ).toBe(note);
    expect(
      within(dialog)
        .getByRole("button", { name: "Close Scanning media root" })
        .matches(":disabled"),
    ).toBe(false);
    const roots = count("/media-roots");
    const media = count("/media-items");
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    await advance();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(count("/media-roots")).toBe(roots + 1);
    expect(count("/media-items")).toBe(media + 1);
    expect(document.querySelector(".window-content[inert]")).toBeNull();
  },
);

it("attaches to another client's running scan when the start reports scan_in_progress", async () => {
  const { api, scan } = renderScanLibrary([mediaRoot()]);
  api.reply(
    SCAN_PATH,
    {
      error: {
        code: "scan_in_progress",
        message: "Media root root is already being scanned",
      },
    },
    "POST",
    409,
  );
  scan.status = scanStatus({
    id: "other-client",
    phase: "probing",
    discoveredCount: 40,
    settledCount: 12,
  });
  const dialog = await startScan();

  expect(within(dialog).getByText("12 of 40 files")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  await advance(1_000);
  expect(screen.queryByText(/replaced this one/)).toBeNull();
});

it("reports other start rejections in the page feedback and opens no dialog", async () => {
  const { api } = renderScanLibrary([mediaRoot()]);
  api.reply(
    SCAN_PATH,
    {
      error: {
        code: "media_root_disabled",
        message: "Media root root is disabled; enable it before scanning",
      },
    },
    "POST",
    409,
  );
  await advance();
  fireEvent.click(screen.getByRole("button", { name: "Scan" }));
  await advance();

  expect(screen.getByRole("alert").textContent).toBe(
    "Media root root is disabled; enable it before scanning",
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("Operation completed successfully.")).toBeNull();
});

it("keeps the last known status through a failed poll and retries", async () => {
  const { api, scan } = renderScanLibrary(
    [mediaRoot()],
    scanStatus({ phase: "probing", discoveredCount: 10, settledCount: 5 }),
  );
  const dialog = await startScan();
  api.handle(SCAN_PATH, () =>
    api.response(
      { error: { code: "internal_error", message: "Server unavailable" } },
      500,
    ),
  );
  await advance(1_000);
  expect(within(dialog).getByText("5 of 10 files")).toBeTruthy();
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeTruthy();

  scan.status = scanStatus({
    phase: "probing",
    discoveredCount: 10,
    settledCount: 6,
  });
  api.handle(SCAN_PATH, () => api.response(scan.status));
  await advance(1_000);
  expect(within(dialog).getByText("6 of 10 files")).toBeTruthy();
});

it.each([
  {
    name: "a 404 poll",
    reply: (api: BrowserApi) =>
      api.response(
        { error: { code: "scan_not_found", message: "No scan" } },
        404,
      ),
    line: "This scan is no longer running on the server. The catalog may be unchanged; scan again.",
  },
  {
    name: "a status for a different job",
    reply: (api: BrowserApi) =>
      api.response(scanStatus({ id: "newer", phase: "probing" })),
    line: "A newer scan of this media root replaced this one.",
  },
])(
  "ends the dialog with its message after $name and stops polling",
  async ({ reply, line }) => {
    const { api, count } = renderScanLibrary([mediaRoot()]);
    const dialog = await startScan();
    api.handle(SCAN_PATH, () => reply(api));
    await advance(1_000);

    expect(statusLine(dialog).textContent).toBe(line);
    const polls = count(SCAN_PATH);
    await advance(5_000);
    expect(count(SCAN_PATH)).toBe(polls);
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    await advance();
    expect(screen.queryByRole("dialog")).toBeNull();
  },
);

it("reattaches on open to running scans in media-root order, one dialog at a time", async () => {
  const roots = [
    mediaRoot({
      id: "done",
      path: "/done",
      scan: scanStatus({ id: "d", rootId: "done", phase: "completed" }),
    }),
    mediaRoot({
      id: "b",
      path: "/b",
      scan: scanStatus({ id: "b1", rootId: "b" }),
    }),
    mediaRoot({
      id: "c",
      path: "/c",
      scan: scanStatus({ id: "c1", rootId: "c" }),
    }),
  ];
  const { api } = renderScanLibrary(roots);
  api.reply("/media-roots/b/scan", scanStatus({ id: "b1", rootId: "b" }));
  api.reply("/media-roots/c/scan", scanStatus({ id: "c1", rootId: "c" }));
  await advance();
  const first = screen.getByRole("dialog", { name: "Scanning media root" });
  expect(statusLine(first).textContent).toBe("Looking for media files in /b…");

  api.reply(
    "/media-roots/b/scan",
    scanStatus({ id: "b1", rootId: "b", phase: "completed" }),
  );
  await advance(1_000);
  // The refreshed list is held; the earlier list may hold scans that have
  // since finished, so no dialog opens from it.
  api.hold("/media-roots");
  fireEvent.click(within(first).getByRole("button", { name: "OK" }));
  await advance();
  expect(screen.queryByRole("dialog")).toBeNull();
  api.release("/media-roots", [
    roots[0],
    {
      ...roots[1],
      scan: scanStatus({ id: "b1", rootId: "b", phase: "completed" }),
    },
    roots[2],
  ]);
  await advance();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(
    statusLine(screen.getByRole("dialog", { name: "Scanning media root" }))
      .textContent,
  ).toBe("Looking for media files in /c…");
});

it("opens no dialog for a scan that finished while another dialog was open", async () => {
  const roots = [
    mediaRoot({
      id: "b",
      path: "/b",
      scan: scanStatus({ id: "b1", rootId: "b" }),
    }),
    mediaRoot({
      id: "c",
      path: "/c",
      scan: scanStatus({ id: "c1", rootId: "c" }),
    }),
  ];
  const { api } = renderScanLibrary(roots);
  api.reply(
    "/media-roots/b/scan",
    scanStatus({ id: "b1", rootId: "b", phase: "completed" }),
  );
  await advance();
  await advance(1_000);
  const first = screen.getByRole("dialog", { name: "Scanning media root" });
  const finished = (id: string, rootId: string) =>
    scanStatus({ id, rootId, phase: "completed" });
  api.reply("/media-roots", [
    { ...roots[0], scan: finished("b1", "b") },
    { ...roots[1], scan: finished("c1", "c") },
  ]);

  fireEvent.click(within(first).getByRole("button", { name: "OK" }));
  await advance();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("stops polling while the window is minimized and resumes on restore", async () => {
  const { setVisible, count } = renderScanLibrary([mediaRoot()]);
  await startScan();
  await advance(1_000);
  const polls = count(SCAN_PATH);
  expect(polls).toBeGreaterThan(0);

  setVisible(false);
  await advance(5_000);
  expect(count(SCAN_PATH)).toBe(polls);
  setVisible(true);
  await advance();
  expect(count(SCAN_PATH)).toBe(polls + 1);
});

it("follows a later scan of the same root without the earlier job's status", async () => {
  const { api, scan } = renderScanLibrary([mediaRoot()]);
  const first = await startScan();
  scan.status = scanStatus({ phase: "cancelled" });
  await advance(1_000);
  fireEvent.click(within(first).getByRole("button", { name: "OK" }));
  await advance();

  const second = scanStatus({ id: "scan-2", discoveredCount: 3 });
  api.reply(SCAN_PATH, second, "POST", 202);
  scan.status = second;
  const dialog = await startScan();
  expect(statusLine(dialog).textContent).toBe(
    "Looking for media files in /media…",
  );
  expect(within(dialog).getByText("3 found")).toBeTruthy();
});
