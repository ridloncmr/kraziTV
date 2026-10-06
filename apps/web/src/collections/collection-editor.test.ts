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
import { CollectionEditor } from "./collection-editor.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("saves explicit draft order, removal and addition while rendering backend eligibility", async () => {
  const api = new BrowserApi();
  api.reply(
    "/media-collections/favorites/items",
    adminFixtures.media.map((item, position) => ({
      ...item,
      mediaItemId: item.id,
      position,
    })),
  );
  api.reply("/media-collections/favorites/status", {
    schedulable: true,
    memberCount: 2,
    schedulableCount: 1,
  });
  api.reply("/media-collections/favorites/items", [], "PUT");
  vi.stubGlobal("fetch", api.fetch);
  const view = render(
    createElement(CollectionEditor, {
      collection: adminFixtures.collections[0],
      media: adminFixtures.media,
      visible: true,
      changed: vi.fn(),
    }),
  );
  await screen.findByText(/Schedulable · 1 eligible/);
  fireEvent.click(await screen.findByRole("button", { name: "Move Zulu up" }));
  view.rerender(
    createElement(CollectionEditor, {
      collection: adminFixtures.collections[0],
      media: adminFixtures.media,
      visible: false,
      changed: vi.fn(),
    }),
  );
  view.rerender(
    createElement(CollectionEditor, {
      collection: adminFixtures.collections[0],
      media: adminFixtures.media,
      visible: true,
      changed: vi.fn(),
    }),
  );
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Move Zulu up" })
        .hasAttribute("disabled"),
    ).toBe(true),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save media order" }));
  await waitFor(() =>
    expect(api.requests.some((request) => request.method === "PUT")).toBe(true),
  );
  expect(
    api.requests.find((request) => request.method === "PUT")?.body,
  ).toEqual({ mediaItemIds: ["a", "z"] });
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Remove Zulu" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove Zulu" }));
  fireEvent.change(screen.getByLabelText("Catalog media"), {
    target: { value: "a" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add media" }));
  fireEvent.click(screen.getByRole("button", { name: "Save media order" }));
  await waitFor(() =>
    expect(
      api.requests.filter((request) => request.method === "PUT"),
    ).toHaveLength(2),
  );
  expect(
    api.requests.filter((request) => request.method === "PUT")[1].body,
  ).toEqual({ mediaItemIds: ["z", "a"] });
});
