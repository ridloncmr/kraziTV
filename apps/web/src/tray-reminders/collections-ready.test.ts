// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Recommendation } from "../http/contracts/collections.js";
import type { MediaRoot } from "../http/contracts/media.js";
import {
  bootDesktop,
  openShortcut,
  renderDesktopShell,
} from "../testing/auth-fixtures.js";
import { BrowserApi } from "../testing/browser-api.js";
import { officeCollection, recommendation } from "../testing/collection-api.js";
import { elapse } from "../testing/fake-time.js";
import { idleRoot, lookingUpRoot } from "../testing/scan-fixtures.js";
import { trayIcon } from "../testing/tray-queries.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const STORAGE_KEY = "krazitv.collectionsReadyReminder";
const RECOMMENDATIONS = "/media-collections/recommendations";
const DAY_MS = 24 * 60 * 60 * 1_000;

/** `count` undecided recommendations of `kind`, numbered from `from`. */
function several(
  kind: Recommendation["criterion"]["kind"],
  count: number,
  from = 1,
): Recommendation[] {
  return Array.from({ length: count }, (_, index) =>
    recommendation(kind, from + index),
  );
}

/** 14 series and 3 franchises still to decide. */
const fourteenAndThree = [
  ...several("series", 14),
  ...several("franchise", 3, 100),
];

/** Boots a settled library: a key set, no job running, nothing left to look up. */
async function boot(
  recommendations: Recommendation[],
  roots: MediaRoot[] = [idleRoot("a")],
) {
  return bootDesktop(undefined, (scripted: BrowserApi) => {
    scripted.reply("/metadata/tmdb-key", { configured: true });
    scripted.reply("/media-roots", roots);
    scripted.reply(RECOMMENDATIONS, recommendations);
    scripted.reply("/media-collections", []);
  });
}

/** Reads this reminder's stored choice, as the next desktop start would. */
const stored = () =>
  JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as unknown;

/** Stores a choice as if the owner had answered at an earlier start. */
const answered = (state: unknown) =>
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

it("opens by itself counting the recommendations still to decide by kind, without taking focus", async () => {
  const focused = document.activeElement;
  await boot([
    ...fourteenAndThree,
    // Already saved as a manual collection, so nothing left to decide.
    recommendation("series", 999, {
      decision: "accepted",
      collectionId: "manual-1",
    }),
  ]);

  const balloon = await screen.findByRole("dialog", {
    name: "kraziTV found 14 shows and 3 movie series",
  });
  expect(
    within(balloon).getByText(
      "Make them into collections, then put them on a channel.",
    ),
  ).toBeTruthy();
  expect(
    within(balloon).getByText(
      "I sorted your whole library. No, nobody thanked me either.",
    ),
  ).toBeTruthy();
  expect(
    within(balloon).getByRole("button", { name: "Make collections" }),
  ).toBeTruthy();
  expect(trayIcon(/^kraziTV found/)?.getAttribute("aria-label")).toBe(
    "kraziTV found 14 shows and 3 movie series",
  );
  expect(document.activeElement).toBe(focused);
});

it.each([
  [several("series", 2), "kraziTV found 2 shows"],
  [several("franchise", 3), "kraziTV found 3 movie series"],
  [
    [recommendation("series", 1), recommendation("franchise", 2)],
    "kraziTV found 1 show and 1 movie series",
  ],
  [several("series", 1_204), "kraziTV found 1,204 shows"],
])(
  "leaves out a kind with none and counts one as one: %#",
  async (listed, title) => {
    await boot(listed);

    expect(await screen.findByRole("dialog", { name: title })).toBeTruthy();
  },
);

it("words a single recommendation as one", async () => {
  await boot([recommendation("franchise", 7)]);

  const balloon = await screen.findByRole("dialog", {
    name: "kraziTV found 1 movie series",
  });
  expect(
    within(balloon).getByText(
      "Make it into a collection, then put it on a channel.",
    ),
  ).toBeTruthy();
});

it("stays away while every recommendation is decided", async () => {
  const api = await boot([
    recommendation("series", 1, {
      decision: "accepted",
      collectionId: "manual-1",
    }),
  ]);
  await vi.waitFor(() =>
    expect(api.requestsTo(RECOMMENDATIONS)).not.toHaveLength(0),
  );

  expect(trayIcon(/^kraziTV found/)).toBeNull();
});

it.each([
  ["no key is set", false, [idleRoot("a")]],
  ["a job runs", true, [lookingUpRoot("a", 1, 2), idleRoot("b")]],
  ["files are left to look up", true, [idleRoot("a", 3)]],
] as const)(
  "never reads recommendations while %s",
  async (_, configured, roots) => {
    const api = await bootDesktop(undefined, (scripted: BrowserApi) => {
      scripted.reply("/metadata/tmdb-key", { configured });
      scripted.reply("/media-roots", [...roots]);
      scripted.reply(RECOMMENDATIONS, fourteenAndThree);
    });
    await vi.waitFor(() =>
      expect(api.requestsTo("/metadata/tmdb-key")).not.toHaveLength(0),
    );
    await screen.findByRole("button", { name: /TMDB/ });

    expect(api.requestsTo(RECOMMENDATIONS)).toHaveLength(0);
    expect(screen.queryByRole("dialog", { name: /kraziTV found/ })).toBeNull();
  },
);

it("opens by itself once the lookups end with recommendations", async () => {
  vi.useFakeTimers();
  const api = new BrowserApi();
  api.reply("/health", { status: "ok" });
  api.reply("/metadata/tmdb-key", { configured: true });
  api.reply("/media-roots", [lookingUpRoot("a", 10, 100)]);
  api.reply(RECOMMENDATIONS, fourteenAndThree);
  renderDesktopShell(api);
  await elapse(0);
  expect(api.requestsTo(RECOMMENDATIONS)).toHaveLength(0);

  api.reply("/media-roots", [idleRoot("a")]);
  await elapse(3_000);
  await elapse(0);

  expect(
    screen.getByRole("dialog", {
      name: "kraziTV found 14 shows and 3 movie series",
    }),
  ).toBeTruthy();
  expect(api.requestsTo(RECOMMENDATIONS)).toHaveLength(1);
});

it("opens Collections on Discover from Make collections, and remembers how many it answered", async () => {
  await boot(fourteenAndThree);
  const balloon = await screen.findByRole("dialog", {
    name: "kraziTV found 14 shows and 3 movie series",
  });
  const before = Date.now();

  fireEvent.click(
    within(balloon).getByRole("button", { name: "Make collections" }),
  );

  const collections = screen.getByRole("region", { name: "Collections" });
  expect(
    await within(collections).findByRole("dialog", {
      name: "Discover collections",
    }),
  ).toBeTruthy();
  expect(stored()).toEqual({
    remindAfter: expect.any(Number),
    answeredCount: 17,
  });
  const { remindAfter } = stored() as { remindAfter: number };
  expect(remindAfter - before).toBeGreaterThanOrEqual(7 * DAY_MS);
  expect(localStorage.getItem("krazitv.tmdbReminder")).toBeNull();
  expect(localStorage.getItem("krazitv.notLookedUpReminder")).toBeNull();
});

it("follows decisions made in Discover without waiting for the window to regain focus", async () => {
  const api = await boot(fourteenAndThree);
  fireEvent.click(
    within(
      await screen.findByRole("dialog", { name: /kraziTV found/ }),
    ).getByRole("button", { name: "Make collections" }),
  );
  const discover = await within(
    screen.getByRole("region", { name: "Collections" }),
  ).findByRole("dialog", { name: "Discover collections" });
  await within(discover).findByRole("button", { name: "Dismiss series 1" });

  // A dismissal leaves 13 shows and 3 movie series still to decide.
  api.reply(`${RECOMMENDATIONS}/dismissal`, null, "POST", 204);
  api.reply(RECOMMENDATIONS, fourteenAndThree.slice(1));
  fireEvent.click(
    within(discover).getByRole("button", { name: "Dismiss series 1" }),
  );
  await vi.waitFor(() =>
    expect(trayIcon(/^kraziTV found/)?.getAttribute("aria-label")).toBe(
      "kraziTV found 13 shows and 3 movie series",
    ),
  );

  // Accepting the last undecided one leaves nothing to remind about.
  api.reply(`${RECOMMENDATIONS}/acceptance`, officeCollection, "POST", 201);
  api.reply(RECOMMENDATIONS, [
    recommendation("series", 2, {
      decision: "accepted",
      collectionId: "manual-2",
    }),
  ]);
  fireEvent.click(
    within(discover).getByRole("button", {
      name: "Create automatic collection from series 2",
    }),
  );
  await vi.waitFor(() => expect(trayIcon(/^kraziTV found/)).toBeNull());
});

it("opens Discover in a Collections window already open, as often as asked, and not on a later plain open", async () => {
  await boot(fourteenAndThree);
  await screen.findByRole("dialog", { name: /kraziTV found/ });
  const collections = openShortcut("Collections");
  await within(collections).findByRole("button", {
    name: "Discover collections…",
  });
  expect(within(collections).queryByRole("dialog")).toBeNull();

  /** Opens the balloon from the tray icon and makes collections. */
  const makeCollections = () => {
    fireEvent.click(trayIcon(/^kraziTV found/)!);
    fireEvent.click(
      within(screen.getByRole("dialog", { name: /kraziTV found/ })).getByRole(
        "button",
        { name: "Make collections" },
      ),
    );
  };
  makeCollections();
  expect(screen.getAllByRole("region", { name: "Collections" })).toHaveLength(
    1,
  );
  const discover = await within(collections).findByRole("dialog", {
    name: "Discover collections",
  });

  // Closed, Discover opens again on the next request.
  fireEvent.click(within(discover).getByRole("button", { name: "Close" }));
  expect(within(collections).queryByRole("dialog")).toBeNull();
  makeCollections();
  await within(collections).findByRole("dialog", {
    name: "Discover collections",
  });

  // A plain open after Collections closes shows its page, not Discover.
  fireEvent.click(screen.getByRole("button", { name: "Close Collections" }));
  const reopened = openShortcut("Collections");
  await within(reopened).findByRole("button", {
    name: "Discover collections…",
  });
  expect(within(reopened).queryByRole("dialog")).toBeNull();
});

it.each([
  [
    "as many as when last answered",
    { remindAfter: 0, answeredCount: 17 },
    fourteenAndThree,
    false,
  ],
  [
    "fewer than when last answered",
    { remindAfter: 0, answeredCount: 20 },
    fourteenAndThree,
    false,
  ],
  [
    "more than when last answered",
    { remindAfter: 0, answeredCount: 16 },
    fourteenAndThree,
    true,
  ],
  [
    "more, but still snoozed",
    { remindAfter: Number.MAX_SAFE_INTEGER, answeredCount: 3 },
    fourteenAndThree,
    false,
  ],
  ["more, after Don't remind me", { never: true }, fourteenAndThree, false],
])(
  "opens by itself with %s only when its snooze is over too",
  async (_, state, listed, opens) => {
    answered(state);
    const api = await boot(listed);
    await vi.waitFor(() =>
      expect(api.requestsTo(RECOMMENDATIONS)).not.toHaveLength(0),
    );

    // The icon shows either way, so the owner can still open it.
    await screen.findByRole("button", {
      name: "kraziTV found 14 shows and 3 movie series",
    });
    expect(screen.queryByRole("dialog") !== null).toBe(opens);
  },
);

it.each([
  ["Remind me later", { remindAfter: expect.any(Number), answeredCount: 17 }],
  ["Don't remind me", { never: true }],
])("stores %s with its own key alone", async (answer, state) => {
  await boot(fourteenAndThree);
  const balloon = await screen.findByRole("dialog", {
    name: /kraziTV found/,
  });

  fireEvent.click(within(balloon).getByRole("button", { name: answer }));

  expect(stored()).toEqual(state);
  expect(localStorage.getItem("krazitv.tmdbReminder")).toBeNull();
  expect(localStorage.getItem("krazitv.notLookedUpReminder")).toBeNull();
});
