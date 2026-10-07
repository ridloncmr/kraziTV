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
  expect(disabled("New collection…")).toBe(true);
  expect(
    screen.getByText(
      "Save or discard changes before switching or creating collections.",
    ),
  ).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  await waitFor(() => expect(disabled("Cartoons")).toBe(false));
  expect(disabled("New collection…")).toBe(false);
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

it("creates a collection in a dialog and opens it for editing", async () => {
  const api = renderApp();
  api.reply("/media-collections", { id: "news", name: "News" }, "POST");
  serveCollection(api, "news", []);
  fireEvent.click(
    await screen.findByRole("button", { name: "New collection…" }),
  );
  fireEvent.change(screen.getByLabelText("Collection name"), {
    target: { value: "News" },
  });
  api.reply("/media-collections", [
    ...collections,
    { id: "news", name: "News" },
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Create collection" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(
    (await screen.findByRole("button", { name: "News" })).getAttribute(
      "aria-current",
    ),
  ).toBe("true");
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
  fireEvent.click(await screen.findByRole("button", { name: "Favorites" }));
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
