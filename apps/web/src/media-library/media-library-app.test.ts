// @vitest-environment jsdom
import { createElement } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { adminFixtures } from "../testing/admin-fixtures.js";
import { BrowserApi } from "../testing/browser-api.js";
import { MediaLibraryApp } from "./media-library-app.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows scan pending state and the actual returned counts", async () => {
  const api = new BrowserApi();
  api.reply("/media-roots", [
    { id: "root", path: "/media", enabled: true, lastScannedAt: null },
  ]);
  api.reply("/media-items", { items: [], total: 0 });
  api.hold("/media-roots/root/scan", "POST");
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(MediaLibraryApp, { visible: true }));
  fireEvent.click(await screen.findByRole("button", { name: "Scan" }));
  expect(screen.getByText(/Scanning \/media/)).toBeTruthy();
  await act(async () => {
    api.release(
      "/media-roots/root/scan",
      {
        discoveredCount: 17,
        probedCount: 12,
        probeFailedCount: 3,
        missingCount: 5,
      },
      "POST",
    );
  });
  expect(screen.getByText("Completed scan")).toBeTruthy();
  expect(screen.getByText("17")).toBeTruthy();
  expect(screen.getByText("3")).toBeTruthy();
});

it("pages the catalog on the server and restarts at the first page for a new search", async () => {
  const api = new BrowserApi();
  api.reply("/media-roots", []);
  api.handle("/media-items", ({ query }) =>
    api.response({
      items: [{ ...adminFixtures.media[0], id: `at-${query.get("offset")}` }],
      total: 120,
    }),
  );
  vi.stubGlobal("fetch", api.fetch);
  const lastQuery = () =>
    api.requests.filter((request) => request.path === "/media-items").at(-1)
      ?.query;
  render(createElement(MediaLibraryApp, { visible: true }));

  await screen.findByText("1–50 of 120");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("51–100 of 120");
  expect(lastQuery()?.get("offset")).toBe("50");
  expect(lastQuery()?.get("limit")).toBe("50");

  fireEvent.change(screen.getByLabelText("Find media"), {
    target: { value: "  pilot " },
  });
  await waitFor(() => expect(lastQuery()?.get("q")).toBe("pilot"));
  expect(lastQuery()?.get("offset")).toBe("0");
});
