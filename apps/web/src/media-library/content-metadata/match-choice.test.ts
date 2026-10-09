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
import type { MediaItem, ReviewStep } from "../../http/contracts.js";
import {
  ALIEN,
  THING,
  WRONG,
  THE_THINGS,
} from "../../testing/admin-fixtures.js";
import { openMediaDetails } from "../../testing/media-library-actions.js";
import { BrowserApi } from "../../testing/browser-api.js";
import { MediaLibraryApp } from "../media-library-app.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The match routes of one item. */
function matchPath(id: string, action: string) {
  return `/metadata/matches/${encodeURIComponent(id)}/${action}`;
}

/** Renders Media Library over `items`, with `steps` waiting for review. */
async function showLibrary(items: MediaItem[], steps: ReviewStep[] = []) {
  const api = new BrowserApi();
  api.reply("/media-roots", []);
  api.reply("/media-items", { items, total: items.length });
  api.reply("/metadata/match-reviews", { steps });
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(MediaLibraryApp, { visible: true }));
  await screen.findByText(items[0].title);
  return api;
}

it("filters the list to items needing a choice, from the first page", async () => {
  const api = await showLibrary([THING]);

  fireEvent.click(
    screen.getByRole("checkbox", { name: "Needs your choice only" }),
  );

  await waitFor(() =>
    expect(
      api.requestsTo("/media-items").at(-1)?.query.get("needsChoice"),
    ).toBe("true"),
  );
  expect(api.requestsTo("/media-items").at(-1)?.query.get("offset")).toBe("0");
});

it("lists each candidate's poster and year beside the file's duration, and chooses one", async () => {
  const api = await showLibrary([THING]);
  api.reply(matchPath(THING.id, "candidates"), THE_THINGS);
  api.reply(matchPath(THING.id, "choice"), { resolvedCount: 1 }, "POST");
  api.reply(matchPath(THING.id, "candidates/10785/runtime"), {
    runtimeMs: 87 * 60_000,
  });
  api.reply(matchPath(THING.id, "candidates/60935/runtime"), {
    runtimeMs: null,
  });

  fireEvent.click(
    within(openMediaDetails("The Thing")).getByRole("button", {
      name: "Choose match…",
    }),
  );
  const dialog = within(
    await screen.findByRole("dialog", { name: "Choose a match" }),
  );

  expect(await dialog.findByText("This file runs 1:49:00.")).toBeTruthy();
  expect(
    dialog
      .getByRole("img", { name: "Poster for The Thing (1982)" })
      .getAttribute("src"),
  ).toBe("https://image.tmdb.org/t/p/w92/thing-1982.jpg");
  expect(dialog.getByText("The Thing (year unknown)")).toBeTruthy();

  // Opening asks for no runtime; each one is read only when asked.
  const runtimeReads = () =>
    api.requests.filter((request) => request.path.endsWith("/runtime"));
  expect(runtimeReads()).toEqual([]);
  fireEvent.click(
    dialog.getByRole("button", { name: "Show runtime of The Thing (1951)" }),
  );
  fireEvent.click(
    dialog.getByRole("button", {
      name: "Show runtime of The Thing (year unknown)",
    }),
  );
  expect(await dialog.findByText("Runtime 1:27:00")).toBeTruthy();
  expect(await dialog.findByText("Runtime unknown")).toBeTruthy();
  expect(runtimeReads().map((request) => request.path)).toEqual([
    matchPath(THING.id, "candidates/10785/runtime"),
    matchPath(THING.id, "candidates/60935/runtime"),
  ]);
  expect(
    dialog.getByRole("button", { name: "Show runtime of The Thing (1982)" }),
  ).toBeTruthy();
  expect(dialog.getByRole("img", { name: "TMDB" })).toBeTruthy();
  expect(dialog.queryByRole("button", { name: "Skip" })).toBeNull();

  fireEvent.click(
    dialog.getByRole("button", { name: "Choose The Thing (1982)" }),
  );

  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Choose a match" })).toBeNull(),
  );
  expect(api.requestsTo(matchPath(THING.id, "choice"))[0]?.body).toEqual({
    tmdbId: 1091,
  });
});

it("rejects a match from details and clears a rejection", async () => {
  const api = await showLibrary([ALIEN, WRONG]);
  api.reply(
    matchPath(ALIEN.id, "rejection"),
    { matchState: "rejected" },
    "POST",
  );
  api.reply(
    matchPath(WRONG.id, "rejection"),
    { matchState: "not_looked_up" },
    "DELETE",
  );

  fireEvent.click(
    within(openMediaDetails("Alien (1979)")).getByRole("button", {
      name: "Reject match",
    }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  const details = within(openMediaDetails("Wrong"));
  expect(details.queryByRole("button", { name: "Reject match" })).toBeNull();
  fireEvent.click(details.getByRole("button", { name: "Clear rejection" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  expect(
    api.requestsTo(matchPath(ALIEN.id, "rejection")).map((r) => r.method),
  ).toEqual(["POST"]);
  expect(
    api.requestsTo(matchPath(WRONG.id, "rejection")).map((r) => r.method),
  ).toEqual(["DELETE"]);
});

it("walks every step, dropping one settled meanwhile, and counts what was done", async () => {
  const steps = ["Doctor Who", "Settled", "The Thing", "Solaris"].map(
    (title, index) => ({ mediaItemId: `step-${index}`, title, itemCount: 1 }),
  );
  const api = await showLibrary([THING], steps);
  api.reply(matchPath("step-0", "candidates"), {
    ...THE_THINGS,
    kind: "series",
  });
  api.reply(matchPath("step-0", "choice"), { resolvedCount: 40 }, "POST");
  api.reply(
    matchPath("step-1", "candidates"),
    {
      error: {
        code: "match_not_ambiguous",
        message: "This item's match has changed.",
      },
    },
    "GET",
    409,
  );
  api.reply(matchPath("step-2", "candidates"), THE_THINGS);
  api.reply(
    matchPath("step-2", "rejection"),
    { matchState: "rejected" },
    "POST",
  );
  api.reply(matchPath("step-3", "candidates"), THE_THINGS);

  fireEvent.click(
    await screen.findByRole("button", { name: "Review matches (4)" }),
  );
  let dialog = within(
    await screen.findByRole("dialog", { name: "Choose a match" }),
  );
  expect(dialog.getByText("Step 1 of 4")).toBeTruthy();
  expect(
    await dialog.findByText("Which series is", { exact: false }),
  ).toBeTruthy();
  fireEvent.click(
    dialog.getByRole("button", { name: "Choose The Thing (1951)" }),
  );

  // Step 2 was settled since the walk-through began, so it is dropped unasked.
  await screen.findByText("Step 3 of 4");
  dialog = within(screen.getByRole("dialog", { name: "Choose a match" }));
  await dialog.findByRole("button", { name: "Choose The Thing (1982)" });
  fireEvent.click(dialog.getByRole("button", { name: "None of these" }));

  await screen.findByText("Step 4 of 4");
  dialog = within(screen.getByRole("dialog", { name: "Choose a match" }));
  fireEvent.click(dialog.getByRole("button", { name: "Skip" }));

  const done = within(
    await screen.findByRole("dialog", { name: "Review matches" }),
  );
  const tally = [
    ...done.getByText("All done.").nextElementSibling!.querySelectorAll("dt"),
  ].map(
    (term) => `${term.textContent} ${term.nextElementSibling?.textContent}`,
  );
  expect(tally).toEqual(["Chosen 1", "Rejected 1", "Skipped 1"]);
  expect(api.requestsTo(matchPath("step-3", "choice"))).toEqual([]);
});

it("keeps choices made before the walk-through closes early", async () => {
  const steps = [
    { mediaItemId: "step-0", title: "The Thing", itemCount: 1 },
    { mediaItemId: "step-1", title: "Solaris", itemCount: 1 },
  ];
  const api = await showLibrary([THING], steps);
  api.reply(matchPath("step-0", "candidates"), THE_THINGS);
  api.reply(matchPath("step-0", "choice"), { resolvedCount: 1 }, "POST");
  api.reply(matchPath("step-1", "candidates"), THE_THINGS);

  fireEvent.click(
    await screen.findByRole("button", { name: "Review matches (2)" }),
  );
  const first = within(
    await screen.findByRole("dialog", { name: "Choose a match" }),
  );
  fireEvent.click(
    await first.findByRole("button", { name: "Choose The Thing (1982)" }),
  );
  await screen.findByText("Step 2 of 2");
  const reviewsBefore = api.requestsTo("/metadata/match-reviews").length;
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Choose a match" })).getByRole(
      "button",
      {
        name: "Close",
      },
    ),
  );

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.requestsTo(matchPath("step-0", "choice"))).toHaveLength(1);
  // Closing refreshes the list and the count, which no longer holds the chosen step.
  await waitFor(() =>
    expect(api.requestsTo("/metadata/match-reviews").length).toBeGreaterThan(
      reviewsBefore,
    ),
  );
});
