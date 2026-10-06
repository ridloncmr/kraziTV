// @vitest-environment jsdom
import { createElement } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
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
  api.reply("/media-items", []);
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
