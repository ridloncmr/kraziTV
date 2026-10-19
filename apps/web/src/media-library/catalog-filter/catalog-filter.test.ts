// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ALIEN } from "../../testing/admin-fixtures.js";
import type { BrowserApi } from "../../testing/browser-api.js";
import { showMediaLibrary } from "../../testing/media-library-actions.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SERIES = Array.from({ length: 10 }, (_, index) => ({
  tmdbId: 100 + index,
  name: index === 0 ? "Firefly" : `Show ${index}`,
  itemCount: 14,
}));

// Shows the library with catalog lists for the filter's dynamic sections.
async function showFilterableLibrary() {
  const api = await showMediaLibrary([ALIEN]);
  api.reply("/media-collections/series", SERIES);
  api.reply("/media-collections/franchises", [
    { tmdbId: 8091, name: "Alien Collection", itemCount: 4 },
  ]);
  api.reply("/media-collections/genres", [
    { name: "Horror", itemCount: 7 },
    { name: "Drama", itemCount: 30 },
  ]);
  api.reply("/media-collections/tags", [
    { tagId: "tag-1", name: "Christmas", itemCount: 3 },
  ]);
  return api;
}

// Opens the filter panel and returns queries scoped to it.
function openFilter(name = "Filter") {
  fireEvent.click(screen.getByRole("button", { name }));
  return within(screen.getByRole("dialog", { name: "Filter media" }));
}

// The filter parameters of the latest list request, keyed by name.
function lastFilter(api: BrowserApi) {
  const query = api.requestsTo("/media-items").at(-1)?.query;
  const kept: Record<string, string[]> = {};
  for (const [key, value] of query ?? []) {
    if (!["q", "limit", "offset"].includes(key)) {
      kept[key] = [...(kept[key] ?? []), value];
    }
  }
  return kept;
}

it("applies several values of several sections together, read from the catalog lists", async () => {
  const api = await showFilterableLibrary();
  const panel = openFilter();

  fireEvent.click(await panel.findByRole("checkbox", { name: /Firefly/ }));
  fireEvent.click(panel.getByRole("checkbox", { name: /Horror/ }));
  fireEvent.click(panel.getByRole("checkbox", { name: /Drama/ }));
  fireEvent.click(panel.getByRole("checkbox", { name: /Christmas/ }));
  fireEvent.click(panel.getByRole("checkbox", { name: "Missing" }));
  fireEvent.click(panel.getByRole("button", { name: "Apply" }));

  await vi.waitFor(() =>
    expect(lastFilter(api)).toEqual({
      genre: ["Horror", "Drama"],
      seriesTmdbId: ["100"],
      status: ["missing"],
      tagId: ["tag-1"],
    }),
  );
  expect(screen.queryByRole("dialog", { name: "Filter media" })).toBeNull();
  expect(screen.getByRole("button", { name: "Filter (4)" })).toBeTruthy();
});

it("narrows a long section by typing without unchecking what it hides", async () => {
  await showFilterableLibrary();
  const panel = openFilter();
  fireEvent.click(await panel.findByRole("checkbox", { name: /Firefly/ }));

  fireEvent.change(panel.getByLabelText("Find tv series"), {
    target: { value: "show 3" },
  });

  expect(
    panel
      .getAllByRole("checkbox", { name: /Show|Firefly/ })
      .map((box) => box.closest("label")?.textContent),
  ).toEqual(["Show 3 (14)"]);
  fireEvent.change(panel.getByLabelText("Find tv series"), {
    target: { value: "" },
  });
  expect(
    panel.getByRole<HTMLInputElement>("checkbox", { name: /Firefly/ }).checked,
  ).toBe(true);
});

it("discards a draft closed with Escape and clears every applied filter", async () => {
  const api = await showFilterableLibrary();
  let panel = openFilter();
  fireEvent.click(panel.getByRole("checkbox", { name: "Extra" }));
  fireEvent.click(panel.getByRole("button", { name: "Apply" }));
  await vi.waitFor(() =>
    expect(lastFilter(api)).toEqual({ matchState: ["extra"] }),
  );

  panel = openFilter("Filter (1)");
  // Focus moves into the panel, which renders apart from its button.
  expect(document.activeElement).toBe(
    panel.getByRole("checkbox", { name: "Matched" }),
  );
  fireEvent.click(panel.getByRole("checkbox", { name: "Matched" }));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "Filter media" })).toBeNull();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Filter (1)" }),
  );

  panel = openFilter("Filter (1)");
  expect(
    panel.getByRole<HTMLInputElement>("checkbox", { name: "Matched" }).checked,
  ).toBe(false);
  fireEvent.click(panel.getByRole("button", { name: "Clear" }));
  await vi.waitFor(() => expect(lastFilter(api)).toEqual({}));
  expect(screen.getByRole("button", { name: "Filter" })).toBeTruthy();
});

it("closes on a click outside the panel", async () => {
  await showFilterableLibrary();
  openFilter();

  fireEvent.pointerDown(screen.getByText("Cataloged media"));

  expect(screen.queryByRole("dialog", { name: "Filter media" })).toBeNull();
});

it("says no media matches the filters when a filtered page is empty", async () => {
  const api = await showFilterableLibrary();
  api.reply("/media-items", { items: [], total: 0 });
  const panel = openFilter();
  fireEvent.click(panel.getByRole("checkbox", { name: "Rejected" }));
  fireEvent.click(panel.getByRole("button", { name: "Apply" }));

  expect(
    await screen.findByText("No cataloged media matches these filters."),
  ).toBeTruthy();
});
