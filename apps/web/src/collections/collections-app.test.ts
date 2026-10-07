// @vitest-environment jsdom
import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BrowserApi } from "../testing/browser-api.js";
import { adminFixtures } from "../testing/admin-fixtures.js";
import { serveCollection } from "../testing/collection-api.js";
import { CollectionsApp } from "./collections-app.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const collections = [
  ...adminFixtures.collections,
  { id: "cartoons", name: "Cartoons" },
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

it("blocks switching or creating collections until an unsaved draft is saved or discarded", async () => {
  renderApp();
  fireEvent.click(await screen.findByRole("button", { name: "Favorites" }));
  fireEvent.click(await screen.findByLabelText("Select member Zulu"));
  fireEvent.click(screen.getByRole("button", { name: "Move to top" }));

  expect(disabled("Cartoons")).toBe(true);
  expect(disabled("Create collection")).toBe(true);
  expect(
    screen.getByText("Save or discard changes before switching collections."),
  ).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  await waitFor(() => expect(disabled("Cartoons")).toBe(false));
  expect(disabled("Create collection")).toBe(false);
});

it("deletes a collection only after confirmation and returns to the list", async () => {
  const api = renderApp();
  api.reply("/media-collections/favorites", null, "DELETE", 204);
  fireEvent.click(await screen.findByRole("button", { name: "Favorites" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Delete collection" }),
  );
  expect(api.requests.some((request) => request.method === "DELETE")).toBe(
    false,
  );

  fireEvent.click(
    screen.getByRole("button", { name: "Delete collection permanently" }),
  );

  await screen.findByText("Choose a collection to edit its media.");
  expect(
    api.requests.find((request) => request.method === "DELETE")?.path,
  ).toBe("/media-collections/favorites");
});
