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
import { DesktopShell } from "./desktop-shell.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("boots, navigates Start, restores one singleton and synchronizes the taskbar through close", async () => {
  const api = new BrowserApi();
  api.reply("/health", { status: "ok" });
  api.reply("/media-roots", []);
  api.reply("/media-items", []);
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(DesktopShell));
  expect(screen.getByLabelText("kraziTV starting")).toBeTruthy();
  fireEvent.click(await screen.findByRole("button", { name: "start" }));
  const menu = screen.getByRole("navigation", { name: "Start programs" });
  fireEvent.click(within(menu).getByRole("button", { name: /Media Library/ }));
  const window = await screen.findByRole("region", { name: "Media Library" });
  fireEvent.click(
    within(window).getByRole("button", { name: "Minimize Media Library" }),
  );
  expect(screen.queryByRole("region", { name: "Media Library" })).toBeNull();
  const taskbar = screen.getByRole("navigation", { name: "Open programs" });
  expect(within(taskbar).getAllByRole("button")).toHaveLength(1);
  fireEvent.click(
    within(taskbar).getByRole("button", { name: "Media Library" }),
  );
  expect(screen.getAllByRole("region", { name: "Media Library" })).toHaveLength(
    1,
  );
  fireEvent.click(
    within(screen.getByLabelText("Desktop programs")).getByRole("button", {
      name: "Media Library",
    }),
  );
  expect(within(taskbar).getAllByRole("button")).toHaveLength(1);
  fireEvent.click(
    within(window).getByRole("button", { name: "Maximize Media Library" }),
  );
  expect(window.className).toContain("maximized");
  fireEvent.click(
    within(window).getByRole("button", { name: "Restore Media Library" }),
  );
  expect(window.className).not.toContain("maximized");
  fireEvent.click(
    within(window).getByRole("button", { name: "Close Media Library" }),
  );
  expect(within(taskbar).queryAllByRole("button")).toHaveLength(0);
});

it("reaches an offline desktop and dismisses Start with keyboard focus restored", async () => {
  const api = new BrowserApi();
  api.reply(
    "/health",
    { error: { code: "offline", message: "Unavailable" } },
    "GET",
    503,
  );
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(DesktopShell));
  const start = await screen.findByRole("button", { name: "start" });
  fireEvent.click(start);
  await waitFor(() =>
    expect(document.activeElement?.textContent).toContain("My Channels"),
  );
  fireEvent.keyDown(document, { key: "Escape" });
  expect(
    screen.queryByRole("navigation", { name: "Start programs" }),
  ).toBeNull();
  expect(document.activeElement).toBe(start);
  expect(
    screen.getByRole("button", { name: "API connection failed" }),
  ).toBeTruthy();
});

it("focuses inactive windows by pointer and moves the focused title with the keyboard", async () => {
  const api = new BrowserApi();
  api.reply("/health", { status: "ok" });
  api.reply("/media-roots", []);
  api.reply("/media-items", []);
  api.reply("/media-collections", []);
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(DesktopShell));
  const shortcuts = await screen.findByLabelText("Desktop programs");
  fireEvent.click(
    within(shortcuts).getByRole("button", { name: "Media Library" }),
  );
  fireEvent.click(
    within(shortcuts).getByRole("button", { name: "Collections" }),
  );
  const media = screen.getByRole("region", { name: "Media Library" });
  const taskbar = screen.getByRole("navigation", { name: "Open programs" });
  const openedButtons = within(taskbar)
    .getAllByRole("button")
    .map((button) => button.textContent);
  const domOrder = () =>
    screen.getAllByRole("region").map((region) => region.ariaLabel);
  const openedRegions = domOrder();
  expect(media.className).toContain("inactive");
  fireEvent.pointerDown(media);
  expect(media.className).toContain("active");
  // Browsers drop a click whose pressed node moves, so focus restacks by z-index only.
  expect(domOrder()).toEqual(openedRegions);
  expect(Number(media.style.zIndex)).toBe(2);
  expect(
    within(taskbar)
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toEqual(openedButtons);
  const title = within(media).getByLabelText(/Media Library window/);
  const before = Number.parseFloat(media.style.left);
  fireEvent.keyDown(title, { key: "ArrowRight" });
  expect(Number.parseFloat(media.style.left)).toBeGreaterThan(before);
});
