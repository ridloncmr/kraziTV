// @vitest-environment jsdom
import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { MediaItem } from "../../http/contracts.js";
import {
  ALIEN,
  FIREFLY,
  OUTAGE,
  itemWith,
} from "../../testing/admin-fixtures.js";
import { openMediaDetails as openDetails } from "../../testing/media-library-actions.js";
import { BrowserApi } from "../../testing/browser-api.js";
import { MediaLibraryApp } from "../media-library-app.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const NOTICE =
  "This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.";

/** Renders Media Library over a catalog of `items` and no media roots. */
async function showCatalog(items: MediaItem[]) {
  const api = new BrowserApi();
  api.reply("/media-roots", []);
  api.reply("/media-items", { items, total: items.length });
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(MediaLibraryApp, { visible: true }));
  await screen.findByText(items[0].title);
}

/** The listed row showing `title`. */
function rowOf(title: string) {
  return screen.getByText(title).closest("tr")!;
}

it("labels each item's match state, naming a failed lookup apart from unmatched", async () => {
  await showCatalog([
    ALIEN,
    OUTAGE,
    itemWith("The Thing", { matchState: "ambiguous" }),
    itemWith("Nothing", { matchState: "unmatched" }),
    itemWith("Making of", { matchState: "extra" }),
    itemWith("Wrong", { matchState: "rejected" }),
    itemWith("New", { matchState: "not_looked_up" }),
  ]);

  const labels = {
    "Alien (1979)": "Matched",
    Outage: "Lookup failed",
    "The Thing": "Needs your choice",
    Nothing: "Unmatched",
    "Making of": "Extra",
    Wrong: "Rejected",
    New: "Not looked up",
  };
  for (const [title, label] of Object.entries(labels)) {
    expect(within(rowOf(title)).getByText(label)).toBeTruthy();
  }
});

it("shows a matched movie's facts, its TMDB poster, and TMDB's notice", async () => {
  await showCatalog([ALIEN]);

  const dialog = within(openDetails("Alien (1979)"));

  for (const fact of [
    "Alien",
    "1979-05-25",
    "Horror, Science Fiction",
    "Alien Collection",
    "In space…",
  ]) {
    expect(dialog.getByText(fact)).toBeTruthy();
  }
  expect(
    dialog.getByRole("img", { name: "Poster for Alien" }).getAttribute("src"),
  ).toBe("https://image.tmdb.org/t/p/w342/alien.jpg");
  expect(dialog.getByRole("img", { name: "TMDB" })).toBeTruthy();
  expect(dialog.getByText(NOTICE)).toBeTruthy();
});

it("names both episodes of a multi-episode file and its series poster", async () => {
  await showCatalog([FIREFLY]);

  const dialog = within(openDetails(FIREFLY.title));

  expect(dialog.getByText("Season 1, episodes 5–6")).toBeTruthy();
  expect(dialog.getByText("Safe / Our Mrs. Reynolds")).toBeTruthy();
  expect(
    dialog.getByRole("img", { name: "Poster for Firefly" }).getAttribute("src"),
  ).toBe("https://image.tmdb.org/t/p/w342/firefly.jpg");
});

it("shows a failed lookup's error without TMDB's notice, since no TMDB facts appear", async () => {
  await showCatalog([OUTAGE]);

  const dialog = within(openDetails("Outage"));

  expect(dialog.getByText("TMDB answered HTTP 503")).toBeTruthy();
  expect(dialog.queryByText(NOTICE)).toBeNull();
  expect(dialog.queryByRole("img")).toBeNull();
});

it("opens details without selecting the row, and Close returns to the list", async () => {
  await showCatalog([ALIEN]);

  openDetails("Alien (1979)");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));

  expect(screen.queryByRole("dialog")).toBeNull();
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", {
      name: "Select Alien (1979)",
    }).checked,
  ).toBe(false);
  expect(screen.queryByText(NOTICE)).toBeNull();
});
