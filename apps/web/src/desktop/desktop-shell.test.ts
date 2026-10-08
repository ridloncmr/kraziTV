// @vitest-environment jsdom
import { createElement } from "react";
import {
  act,
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

it("navigates Start, restores one singleton and synchronizes the taskbar through close", async () => {
  const api = new BrowserApi();
  api.reply("/health", { status: "ok" });
  api.reply("/media-roots", []);
  api.reply("/media-items", { items: [], total: 0 });
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(DesktopShell, { onLoggedOff: () => {} }));
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
  render(createElement(DesktopShell, { onLoggedOff: () => {} }));
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
    await screen.findByRole("button", { name: "API connection failed" }),
  ).toBeTruthy();
});

it("keeps windows on screen while the browser shrinks and restores their places when it grows", async () => {
  const api = new BrowserApi();
  api.reply("/health", { status: "ok" });
  api.reply("/media-roots", []);
  api.reply("/media-items", { items: [], total: 0 });
  vi.stubGlobal("fetch", api.fetch);
  vi.stubGlobal("innerWidth", 1280);
  vi.stubGlobal("innerHeight", 800);
  render(createElement(DesktopShell, { onLoggedOff: () => {} }));
  const shortcuts = await screen.findByLabelText("Desktop programs");
  fireEvent.click(
    within(shortcuts).getByRole("button", { name: "Media Library" }),
  );
  const media = screen.getByRole("region", { name: "Media Library" });
  const title = within(media).getByLabelText(/Media Library window/);
  for (let step = 0; step < 10; step++)
    fireEvent.keyDown(title, { key: "ArrowRight" });
  const placed = { left: media.style.left, top: media.style.top };
  expect(placed).toEqual({ left: "340px", top: "40px" });
  /** Simulates dragging the browser between monitors of different sizes. */
  const resizeTo = (width: number, height: number) =>
    act(() => {
      vi.stubGlobal("innerWidth", width);
      vi.stubGlobal("innerHeight", height);
      globalThis.dispatchEvent(new Event("resize"));
    });
  resizeTo(800, 600);
  expect({ left: media.style.left, top: media.style.top }).toEqual({
    left: "40px",
    top: "28px",
  });
  resizeTo(1280, 800);
  expect({ left: media.style.left, top: media.style.top }).toEqual(placed);
});

it("focuses inactive windows by pointer and moves the focused title with the keyboard", async () => {
  const api = new BrowserApi();
  api.reply("/health", { status: "ok" });
  api.reply("/media-roots", []);
  api.reply("/media-items", { items: [], total: 0 });
  api.reply("/media-collections", []);
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(DesktopShell, { onLoggedOff: () => {} }));
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

it("resizes by grip and keyboard within the space below and right of the window", async () => {
  const api = new BrowserApi();
  api.reply("/health", { status: "ok" });
  api.reply("/media-roots", []);
  api.reply("/media-items", { items: [], total: 0 });
  vi.stubGlobal("fetch", api.fetch);
  vi.stubGlobal("innerWidth", 1280);
  vi.stubGlobal("innerHeight", 800);
  render(createElement(DesktopShell, { onLoggedOff: () => {} }));
  const shortcuts = await screen.findByLabelText("Desktop programs");
  fireEvent.click(
    within(shortcuts).getByRole("button", { name: "Media Library" }),
  );
  const media = screen.getByRole("region", { name: "Media Library" });
  const size = () => ({ width: media.style.width, height: media.style.height });
  expect(size()).toEqual({ width: "760px", height: "540px" });
  // jsdom implements no pointer capture; the browser keeps the grip tracking off-element.
  const grip = Object.assign(media.querySelector(".resize-grip")!, {
    setPointerCapture: vi.fn(),
  });
  fireEvent.pointerDown(grip, { button: 0, clientX: 900, clientY: 580 });
  fireEvent.pointerMove(grip, { clientX: 1000, clientY: 500 });
  fireEvent.pointerUp(grip);
  expect(size()).toEqual({ width: "860px", height: "460px" });
  // The window sits at 140,40 in a 1280x768 desktop, so growth stops at the edges.
  fireEvent.pointerDown(grip, { button: 0, clientX: 0, clientY: 0 });
  fireEvent.pointerMove(grip, { clientX: 2000, clientY: 2000 });
  fireEvent.pointerUp(grip);
  expect(size()).toEqual({ width: "1140px", height: "728px" });
  const title = within(media).getByLabelText(/Media Library window/);
  for (let step = 0; step < 50; step++)
    fireEvent.keyDown(title, { key: "ArrowLeft", shiftKey: true });
  expect(size()).toEqual({ width: "360px", height: "728px" });
  expect(media.style.left).toBe("140px");
});
