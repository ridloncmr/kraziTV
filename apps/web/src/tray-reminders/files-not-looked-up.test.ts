// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { MediaRoot } from "../http/contracts/media.js";
import { bootDesktop, renderDesktopShell } from "../testing/auth-fixtures.js";
import { BrowserApi } from "../testing/browser-api.js";
import { elapse } from "../testing/fake-time.js";
import { regainFocus } from "../testing/regain-focus.js";
import {
  idleRoot,
  lookingUpRoot,
  mediaRoot,
} from "../testing/scan-fixtures.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const STORAGE_KEY = "krazitv.notLookedUpReminder";
const SENTENCE =
  "Look them up so kraziTV can name their shows and suggest collections.";
const QUIP = "Paperwork doesn't file itself. I've checked.";

/** Boots the desktop with the server reporting `configured` and `roots`. */
async function boot(roots: MediaRoot[], configured = true) {
  return bootDesktop(undefined, (scripted: BrowserApi) => {
    scripted.reply("/metadata/tmdb-key", { configured });
    scripted.reply("/media-roots", roots);
    scripted.reply("/media-collections/recommendations", []);
  });
}

/** The tray's one icon, by whatever it is labelled. */
const trayIcon = () =>
  within(screen.getByRole("contentinfo")).queryByRole("button", {
    name: /TMDB/,
  });

/** Reads this reminder's stored choice, as the next desktop start would. */
const stored = () =>
  JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as unknown;

it("opens by itself with the never-looked-up files of every enabled root, without taking focus", async () => {
  const focused = document.activeElement;
  await boot([
    idleRoot("a", 300),
    idleRoot("b", 12),
    // A disabled root's files are not counted, nor is a failed lookup.
    { ...idleRoot("c", 500), enabled: false },
    mediaRoot({
      id: "d",
      path: "/media/d",
      matchCounts: {
        items: 40,
        matched: 0,
        needsChoice: 0,
        notLookedUp: 0,
        failedLookups: 40,
      },
    }),
  ]);

  const balloon = await screen.findByRole("dialog", {
    name: "312 files haven't been looked up on TMDB",
  });
  expect(within(balloon).getByText(SENTENCE)).toBeTruthy();
  expect(within(balloon).getByText(QUIP)).toBeTruthy();
  expect(
    within(balloon).getByRole("button", { name: "Look them up" }),
  ).toBeTruthy();
  expect(trayIcon()?.getAttribute("aria-label")).toBe(
    "312 files haven't been looked up on TMDB",
  );
  expect(document.activeElement).toBe(focused);
});

it("counts one file as one", async () => {
  await boot([idleRoot("a", 1)]);

  const balloon = await screen.findByRole("dialog", {
    name: "1 file hasn't been looked up on TMDB",
  });
  expect(
    within(balloon).getByText(
      "Look it up so kraziTV can name its show and suggest collections.",
    ),
  ).toBeTruthy();
  expect(
    within(balloon).getByRole("button", { name: "Look it up" }),
  ).toBeTruthy();
});

it("stays away with no key, leaving the tray to TMDB isn't set up", async () => {
  await boot([idleRoot("a", 300)], false);

  await screen.findByRole("dialog", { name: "TMDB isn't set up" });
  expect(
    screen.queryByRole("button", { name: /haven't been looked up/ }),
  ).toBeNull();
});

it("stays away while nothing is left to look up", async () => {
  const api = await boot([idleRoot("a", 0)]);
  await vi.waitFor(() =>
    expect(
      api.requestsTo("/media-collections/recommendations"),
    ).not.toHaveLength(0),
  );

  expect(trayIcon()).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("waits while a job runs, then opens by itself once when the jobs end with files left", async () => {
  vi.useFakeTimers();
  const api = new BrowserApi();
  api.reply("/health", { status: "ok" });
  api.reply("/metadata/tmdb-key", { configured: true });
  api.reply("/media-collections/recommendations", []);
  // One root is still being looked up while another has files left over.
  api.reply("/media-roots", [lookingUpRoot("a", 10, 100), idleRoot("b", 7)]);
  renderDesktopShell(api);
  await elapse(0);
  expect(trayIcon()?.getAttribute("aria-label")).toBe(
    "Looking up files on TMDB: 10 of 100",
  );
  expect(screen.queryByRole("dialog")).toBeNull();

  api.reply("/media-roots", [idleRoot("a", 5), idleRoot("b", 7)]);
  await elapse(3_000);
  expect(
    screen.getByRole("dialog", {
      name: "12 files haven't been looked up on TMDB",
    }),
  ).toBeTruthy();

  // Closed unanswered by a new job, it does not reopen when that job ends.
  api.reply("/media-roots", [lookingUpRoot("a", 0, 5), idleRoot("b", 7)]);
  regainFocus();
  await elapse(0);
  expect(screen.queryByRole("dialog")).toBeNull();
  api.reply("/media-roots", [idleRoot("a", 5), idleRoot("b", 7)]);
  await elapse(3_000);
  expect(trayIcon()?.getAttribute("aria-label")).toBe(
    "12 files haven't been looked up on TMDB",
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  // Never read while files are left to look up.
  expect(api.requestsTo("/media-collections/recommendations")).toHaveLength(0);
});

it("looks every root up from Look them up, following the jobs it starts, and snoozes only itself", async () => {
  const api = await boot([idleRoot("a", 300), idleRoot("b", 12)]);
  const balloon = await screen.findByRole("dialog", {
    name: "312 files haven't been looked up on TMDB",
  });
  api.reply(
    "/metadata/lookup-retries",
    { lookupCount: 312, busyRootCount: 0 },
    "POST",
    202,
  );
  // What the server's roots say once the lookups have started.
  api.reply("/media-roots", [
    lookingUpRoot("a", 0, 300),
    lookingUpRoot("b", 0, 12),
  ]);

  fireEvent.click(
    within(balloon).getByRole("button", { name: "Look them up" }),
  );

  expect(
    await screen.findByRole("button", {
      name: "Looking up files on TMDB: 0 of 312",
    }),
  ).toBeTruthy();
  expect(
    api.requestsTo("/metadata/lookup-retries").map((request) => request.body),
  ).toEqual([{ scope: "outstanding" }]);
  expect(stored()).toEqual({ remindAfter: expect.any(Number) });
  expect(localStorage.getItem("krazitv.tmdbReminder")).toBeNull();
});

it("keeps offering itself when Look them up is refused", async () => {
  const api = await boot([idleRoot("a", 3)]);
  const balloon = await screen.findByRole("dialog", {
    name: "3 files haven't been looked up on TMDB",
  });
  api.reply(
    "/metadata/lookup-retries",
    { error: { code: "shutting_down", message: "Shutting down" } },
    "POST",
    409,
  );
  const reads = api.requestsTo("/media-roots").length;

  fireEvent.click(
    within(balloon).getByRole("button", { name: "Look them up" }),
  );

  // The shell re-reads the roots after the answer, and the icon stays.
  await vi.waitFor(() =>
    expect(api.requestsTo("/media-roots").length).toBe(reads + 1),
  );
  expect(trayIcon()?.getAttribute("aria-label")).toBe(
    "3 files haven't been looked up on TMDB",
  );
});
