// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { adminFixtures, UNREADABLE } from "../testing/admin-fixtures.js";
import { BrowserApi } from "../testing/browser-api.js";
import { MediaItemPicker } from "./media-item-picker.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("keeps a chosen item outside the results listed by loading it by ID", async () => {
  const api = new BrowserApi();
  api.reply("/media-items", { items: adminFixtures.media, total: 2 });
  api.reply("/media-items/far", {
    ...adminFixtures.media[0],
    id: "far",
    title: "Far away",
  });
  vi.stubGlobal("fetch", api.fetch);
  render(
    createElement(MediaItemPicker, {
      label: "Programming source",
      value: "far",
      visible: true,
      onChange: vi.fn(),
    }),
  );

  await screen.findByRole("option", { name: "Alpha" });
  await screen.findByRole("option", { name: "Far away" });
  expect(
    screen.getByLabelText<HTMLSelectElement>("Programming source").value,
  ).toBe("far");
});

it("hides excluded items and says how many matches the page left out", async () => {
  const api = new BrowserApi();
  api.reply("/media-items", { items: adminFixtures.media, total: 30 });
  vi.stubGlobal("fetch", api.fetch);
  render(
    createElement(MediaItemPicker, {
      label: "Catalog media",
      value: "",
      exclude: ["a"],
      visible: true,
      onChange: vi.fn(),
    }),
  );

  await screen.findByRole("option", { name: "Alpha" });
  expect(screen.queryByRole("option", { name: /^Zulu/ })).toBeNull();
  expect(screen.getByText(/28 more matches/)).toBeTruthy();
});

it("names each unusable item's availability after its title", async () => {
  const api = new BrowserApi();
  api.reply("/media-items", {
    items: [...adminFixtures.media, UNREADABLE],
    total: 3,
  });
  vi.stubGlobal("fetch", api.fetch);
  render(
    createElement(MediaItemPicker, {
      label: "Catalog media",
      value: "",
      visible: true,
      onChange: vi.fn(),
    }),
  );

  await screen.findByRole("option", { name: "Alpha" });
  expect(screen.getByRole("option", { name: "Zulu (Missing)" })).toBeTruthy();
  expect(
    screen.getByRole("option", { name: "Unreadable (Could not be read)" }),
  ).toBeTruthy();
});
