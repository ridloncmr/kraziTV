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
import { BrowserApi } from "../testing/browser-api.js";
import { adminFixtures, collectionWith } from "../testing/admin-fixtures.js";
import { serveCollection } from "../testing/collection-api.js";
import { CollectionsApp } from "./collections-app.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const collections = [
  ...adminFixtures.collections,
  collectionWith("cartoons", "Cartoons", { memberCount: 1 }),
];

// Serves two collections, favorites holding both fixture media, and renders the program.
function renderApp() {
  const api = new BrowserApi();
  api.reply("/media-collections", collections);
  serveCollection(api, "favorites", ["z", "a"]);
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(CollectionsApp, { visible: true }));
  return api;
}

function disabled(name: string) {
  return screen.getByRole("button", { name }).matches(":disabled");
}

// Opens a collection's card from the Manual grid once the list has loaded.
async function open(name: string) {
  fireEvent.click(await screen.findByRole("button", { name: `Open ${name}` }));
  await screen.findByRole("heading", { name });
}

it("lists manual collections as cards with their member counts and opens one for editing", async () => {
  renderApp();

  const manual = await screen.findByRole("tab", { name: "Manual" });
  expect(manual.getAttribute("aria-selected")).toBe("true");
  const grid = screen.getByRole("tabpanel", { name: "Manual" });
  expect(
    within(grid)
      .getAllByRole("button", { name: /^Open / })
      .map((card) => card.textContent),
  ).toEqual(["Favorites2 items", "Cartoons1 item"]);

  // The count is announced with the card, not only shown.
  expect(
    screen.getByRole("button", {
      name: "Open Cartoons",
      description: "1 item",
    }),
  ).toBeTruthy();
  await open("Favorites");

  expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe(
    "Favorites",
  );
  expect(screen.queryByRole("tablist")).toBeNull();
});

it("shows an empty Automatic tab without listing manual collections there", async () => {
  renderApp();

  fireEvent.click(await screen.findByRole("tab", { name: "Automatic" }));

  const grid = screen.getByRole("tabpanel", { name: "Automatic" });
  expect(within(grid).queryByRole("button", { name: /^Open / })).toBeNull();
  expect(within(grid).getByText(/No automatic collections yet/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "New collection…" })).toBeNull();
});

it("blocks leaving an unsaved draft until it is saved or discarded", async () => {
  renderApp();
  await open("Favorites");
  fireEvent.click(await screen.findByLabelText("Select member Zulu"));
  fireEvent.click(screen.getByRole("button", { name: "Move to top" }));

  expect(disabled("All collections")).toBe(true);
  expect(
    screen.getByText("Save or discard changes before leaving this collection."),
  ).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  await waitFor(() => expect(disabled("All collections")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "All collections" }));
  await screen.findByRole("tab", { name: "Manual" });
});

it("deletes a collection only after confirmation and returns to the grid", async () => {
  const api = renderApp();
  api.reply("/media-collections/favorites", null, "DELETE", 204);
  await open("Favorites");
  fireEvent.click(
    await screen.findByRole("button", { name: "Delete collection" }),
  );
  expect(api.requests.some((request) => request.method === "DELETE")).toBe(
    false,
  );

  fireEvent.click(
    screen.getByRole("button", { name: "Delete collection permanently" }),
  );

  await screen.findByRole("tab", { name: "Manual" });
  expect(
    api.requests.find((request) => request.method === "DELETE")?.path,
  ).toBe("/media-collections/favorites");
});

it("creates a collection in a dialog and opens it for editing", async () => {
  const api = renderApp();
  // The create response carries no member count; only the listing does.
  api.reply(
    "/media-collections",
    { id: "news", name: "News", maintenanceMode: "manual" },
    "POST",
  );
  serveCollection(api, "news", []);
  fireEvent.click(
    await screen.findByRole("button", { name: "New collection…" }),
  );
  fireEvent.change(screen.getByLabelText("Collection name"), {
    target: { value: "News" },
  });
  api.reply("/media-collections", [
    ...collections,
    collectionWith("news", "News"),
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Create collection" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await screen.findByRole("heading", { name: "News" });
  expect(
    api.requests.find((request) => request.method === "POST")?.body,
  ).toEqual({ name: "News" });
});

it("reports a rejected delete inside its confirmation", async () => {
  const api = renderApp();
  api.reply(
    "/media-collections/favorites",
    {
      error: {
        code: "collection_in_use",
        message: "A channel programs from this collection",
      },
    },
    "DELETE",
    409,
  );
  await open("Favorites");
  fireEvent.click(
    await screen.findByRole("button", { name: "Delete collection" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Delete collection permanently" }),
  );

  expect(
    (
      await screen.findByText("A channel programs from this collection")
    ).closest('[role="dialog"]'),
  ).toBe(screen.getByRole("dialog", { name: "Delete collection" }));
});
