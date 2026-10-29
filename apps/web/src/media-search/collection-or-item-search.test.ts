// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { MediaCollection } from "../http/contracts/collections.js";
import type { MediaItem } from "../http/contracts/media.js";
import { adminFixtures, collectionWith } from "../testing/admin-fixtures.js";
import { BrowserApi } from "../testing/browser-api.js";
import { officeCollection } from "../testing/collection-api.js";
import { elapse } from "../testing/fake-time.js";
import { CollectionOrItemSearch } from "./collection-or-item-search.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const FAVORITES = collectionWith("favorites", "Favorites");
const [ALPHA, ZULU] = adminFixtures.media;

/** `count` listed items named by number, as one page of the catalog. */
function numberedItems(count: number, from = 1): MediaItem[] {
  return Array.from({ length: count }, (_, index) => ({
    ...ALPHA,
    id: `item-${from + index}`,
    title: `Item ${from + index}`,
    path: `/media/item-${from + index}.mkv`,
  }));
}

type SearchProps = Parameters<typeof CollectionOrItemSearch>[0];

/**
 * Renders the picker against `api` with nothing checked, recording what the
 * owner toggles and opens. `rerender` passes new props over the first ones,
 * as a caller holding the checks would after a toggle.
 */
function renderSearch(api: BrowserApi, props: Partial<SearchProps> = {}) {
  vi.stubGlobal("fetch", api.fetch);
  const onToggle = vi.fn<SearchProps["onToggle"]>();
  const openProgram = vi.fn<SearchProps["openProgram"]>();
  const base: SearchProps = {
    collections: [FAVORITES, officeCollection],
    checked: new Set(),
    visible: true,
    onToggle,
    openProgram,
    ...props,
  };
  const view = render(createElement(CollectionOrItemSearch, base));
  return {
    onToggle,
    openProgram,
    rerender: (next: Partial<SearchProps>) =>
      view.rerender(
        createElement(CollectionOrItemSearch, { ...base, ...next }),
      ),
  };
}

/** The names of the results listed, in order. */
function resultNames(): string[] {
  const list = screen.getByRole("list", { name: "Search results" });
  // A result's label holds its checkbox, then its name, then its detail.
  return Array.from(
    list.querySelectorAll("label"),
    (label) => label.childNodes[1]?.textContent ?? "",
  );
}

/** Switches the picker to single media items. */
function searchItems() {
  fireEvent.click(screen.getByRole("radio", { name: "Single items" }));
}

/** The latest page request's search, offset, and limit. */
function lastPage(api: BrowserApi) {
  const query = api.requestsTo("/media-items").at(-1)?.query;
  return {
    q: query?.get("q"),
    offset: query?.get("offset"),
    limit: query?.get("limit"),
  };
}

it("matches collections by name as the owner types, naming each one's kind", () => {
  renderSearch(new BrowserApi());

  expect(resultNames()).toEqual(["Favorites", "The Office"]);
  expect(screen.getByText("Manual collection")).toBeTruthy();
  expect(screen.getByText("Automatic collection")).toBeTruthy();

  fireEvent.change(screen.getByLabelText("Find collections"), {
    target: { value: "OFF" },
  });
  expect(resultNames()).toEqual(["The Office"]);
});

it("reads no media until the owner searches single items", async () => {
  const api = new BrowserApi();
  api.reply("/media-items", { items: [ALPHA, ZULU], total: 2 });
  renderSearch(api);
  expect(api.requests).toEqual([]);

  searchItems();

  expect(await screen.findByText("/media/alpha.mp4")).toBeTruthy();
  expect(resultNames()).toEqual(["Alpha", "Zulu"]);
  expect(lastPage(api)).toEqual({ q: "", offset: "0", limit: "25" });
  expect(screen.getByLabelText("Find media")).toBeTruthy();
});

it("pages through items 25 at a time and starts over on a new search", async () => {
  vi.useFakeTimers();
  const api = new BrowserApi();
  api.handle("/media-items", (request) => {
    const offset = Number(request.query.get("offset"));
    const total = request.query.get("q") ? 3 : 60;
    return api.response({
      items: numberedItems(Math.min(25, total - offset), offset + 1),
      total,
    });
  });
  renderSearch(api);
  searchItems();
  await elapse(0);
  expect(screen.getByText("1–25 of 60")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await elapse(0);
  expect(lastPage(api)).toEqual({ q: "", offset: "25", limit: "25" });
  expect(screen.getByText("26–50 of 60")).toBeTruthy();
  expect(resultNames()[0]).toBe("Item 26");

  // Typing waits for a pause, then reads the first page of the new search.
  const reads = api.requests.length;
  fireEvent.change(screen.getByLabelText("Find media"), {
    target: { value: "item" },
  });
  await elapse(200);
  expect(api.requests).toHaveLength(reads);
  await elapse(50);
  expect(lastPage(api)).toEqual({ q: "item", offset: "0", limit: "25" });
  expect(resultNames()).toEqual(["Item 1", "Item 2", "Item 3"]);
  expect(screen.queryByRole("navigation", { name: "Pages" })).toBeNull();
});

it("toggles one result through the caller, which holds the checks", async () => {
  const { onToggle, rerender } = renderSearch(new BrowserApi());

  fireEvent.click(screen.getByRole("checkbox", { name: /The Office/ }));
  expect(onToggle).toHaveBeenCalledExactlyOnceWith(
    {
      member: { kind: "collection", mediaCollectionId: "office" },
      name: "The Office",
      detail: "Automatic collection",
    },
    true,
  );

  // A check survives switching kinds because the caller, not the picker, holds it.
  rerender({ checked: new Set(["collection:office"]) });
  searchItems();
  fireEvent.click(screen.getByRole("radio", { name: "Collections" }));
  const office = screen.getByRole<HTMLInputElement>("checkbox", {
    name: /The Office/,
  });
  expect(office.checked).toBe(true);
  fireEvent.click(office);
  expect(onToggle).toHaveBeenLastCalledWith(
    expect.objectContaining({ name: "The Office" }),
    false,
  );
});

it("selects every result that can be checked, then clears them all", () => {
  const { onToggle, rerender } = renderSearch(new BrowserApi(), {
    collections: [
      FAVORITES,
      officeCollection,
      collectionWith("empty", "Empty"),
    ],
    checked: new Set(["collection:favorites"]),
    unavailable: new Map([["collection:empty", "Has no members"]]),
  });
  const all = () =>
    screen.getByRole<HTMLInputElement>("checkbox", { name: "Select all" });

  expect(all().indeterminate).toBe(true);
  expect(all().checked).toBe(false);
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", { name: /Empty/ }).disabled,
  ).toBe(true);
  expect(screen.getByText(/Has no members/)).toBeTruthy();

  // Only the unchecked result that can be checked changes.
  fireEvent.click(all());
  expect(onToggle.mock.calls.map(([found, on]) => [found.name, on])).toEqual([
    ["The Office", true],
  ]);

  rerender({ checked: new Set(["collection:favorites", "collection:office"]) });
  expect(all().indeterminate).toBe(false);
  expect(all().checked).toBe(true);
  onToggle.mockClear();
  fireEvent.click(all());
  expect(onToggle.mock.calls.map(([found, on]) => [found.name, on])).toEqual([
    ["Favorites", false],
    ["The Office", false],
  ]);
});

it("selects only the items on the shown page", async () => {
  const api = new BrowserApi();
  api.reply("/media-items", { items: numberedItems(2), total: 40 });
  const { onToggle } = renderSearch(api);
  searchItems();

  fireEvent.click(
    await screen.findByRole("checkbox", { name: "Select all on this page" }),
  );

  expect(onToggle.mock.calls.map(([found]) => found.member)).toEqual([
    { kind: "media_item", mediaItemId: "item-1" },
    { kind: "media_item", mediaItemId: "item-2" },
  ]);
});

it("leaves hidden results out and says when everything matching is already added", async () => {
  const api = new BrowserApi();
  api.reply("/media-items", { items: [ALPHA], total: 1 });
  renderSearch(api, {
    hidden: new Set(["collection:office", `media_item:${ALPHA.id}`]),
  });

  expect(resultNames()).toEqual(["Favorites"]);
  fireEvent.change(screen.getByLabelText("Find collections"), {
    target: { value: "office" },
  });
  expect(resultNames()).toEqual([]);
  expect(
    screen.getByText("Every matching collection is already added."),
  ).toBeTruthy();
  expect(screen.queryByRole("checkbox", { name: "Select all" })).toBeNull();

  searchItems();
  expect(
    await screen.findByText("Everything on this page is already added."),
  ).toBeTruthy();
});

it("opens Media Library when no collection exists yet, but not when a search misses", () => {
  const { openProgram, rerender } = renderSearch(new BrowserApi(), {
    collections: undefined,
  });
  // Still loading is not empty.
  expect(screen.queryByText("There are no collections yet.")).toBeNull();

  rerender({ collections: [] satisfies MediaCollection[] });
  expect(screen.getByText("There are no collections yet.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Open Media Library" }));
  expect(openProgram).toHaveBeenCalledExactlyOnceWith("media");

  rerender({ collections: [FAVORITES] });
  fireEvent.change(screen.getByLabelText("Find collections"), {
    target: { value: "Nope" },
  });
  expect(screen.getByText("No collection matches that search.")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Open Media Library" }),
  ).toBeNull();
});

it("opens Media Library when the catalog is empty, but not when a search or filter misses", async () => {
  const api = new BrowserApi();
  api.reply("/media-items", { items: [], total: 0 });
  api.reply("/media-roots", []);
  for (const list of ["series", "franchises", "genres", "tags"]) {
    api.reply(`/media-collections/${list}`, []);
  }
  const { openProgram } = renderSearch(api);
  searchItems();

  expect(await screen.findByText("The catalog has no media yet.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Open Media Library" }));
  expect(openProgram).toHaveBeenCalledExactlyOnceWith("media");

  fireEvent.click(screen.getByRole("button", { name: "Filter…" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Missing" }));
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(
    await screen.findByText("No media matches these filters."),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Open Media Library" }),
  ).toBeNull();

  fireEvent.change(screen.getByLabelText("Find media"), {
    target: { value: "nope" },
  });
  expect(await screen.findByText("No media matches that search.")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Open Media Library" }),
  ).toBeNull();
});
