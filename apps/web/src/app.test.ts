// @vitest-environment jsdom
import { createElement } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BrowserApi } from "./testing/browser-api.js";
import { App } from "./app.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const account = { displayName: "Marguerite", avatarId: "duck" };
const loggedOut = { setupRequired: false, account, authenticated: false };
const loggedIn = { ...loggedOut, authenticated: true };
const offline = { error: { code: "offline", message: "Unavailable" } };

/** A browser API whose `/auth/state` answers `state`, with a healthy desktop behind it. */
function apiAnswering(state: unknown, status = 200): BrowserApi {
  const api = new BrowserApi();
  api.reply("/auth/state", state, "GET", status);
  api.reply("/health", { status: "ok" });
  vi.stubGlobal("fetch", api.fetch);
  return api;
}

it("boots through the auth state and opens the desktop for a logged-in browser", async () => {
  apiAnswering(loggedIn);
  render(createElement(App));
  expect(screen.getByLabelText("kraziTV starting")).toBeTruthy();
  expect(await screen.findByRole("button", { name: "start" })).toBeTruthy();
  expect(screen.queryByLabelText("kraziTV starting")).toBeNull();
});

it("keeps the boot screen up for its minimum duration even when the state answers at once", async () => {
  vi.useFakeTimers();
  apiAnswering(loggedIn);
  render(createElement(App));
  await act(() => vi.advanceTimersByTimeAsync(600));
  expect(screen.getByLabelText("kraziTV starting")).toBeTruthy();
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(screen.queryByLabelText("kraziTV starting")).toBeNull();
  expect(screen.getByRole("button", { name: "start" })).toBeTruthy();
});

it("shows the logon screen with the account's tile when the browser has no session", async () => {
  apiAnswering(loggedOut);
  render(createElement(App));
  const logon = await screen.findByRole("main", { name: "Log on to kraziTV" });
  expect(
    within(logon).getByRole("button", { name: "Marguerite" }),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "start" })).toBeNull();
});

it("shows the setup placeholder while the account is not set up", async () => {
  apiAnswering({ setupRequired: true, account: null, authenticated: false });
  render(createElement(App));
  expect(await screen.findByText(/Finish setup/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "start" })).toBeNull();
});

it("says the server is unreachable and opens the right screen after Retry", async () => {
  const api = apiAnswering(offline, 503);
  render(createElement(App));
  expect(
    await screen.findByText("kraziTV can't reach its server."),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "start" })).toBeNull();
  api.reply("/auth/state", loggedOut);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(
    await screen.findByRole("button", { name: "Marguerite" }),
  ).toBeTruthy();
});

it("retries the unreachable server on its own every 10 seconds", async () => {
  vi.useFakeTimers();
  const api = apiAnswering(offline, 503);
  render(createElement(App));
  await act(() => vi.advanceTimersByTimeAsync(700));
  expect(screen.getByText("kraziTV can't reach its server.")).toBeTruthy();
  const stateReads = () =>
    api.requests.filter((request) => request.path === "/auth/state").length;
  expect(stateReads()).toBe(1);
  await act(() => vi.advanceTimersByTimeAsync(9_000));
  expect(stateReads()).toBe(1);
  api.reply("/auth/state", loggedIn);
  await act(() => vi.advanceTimersByTimeAsync(1_000));
  expect(stateReads()).toBe(2);
  expect(screen.getByRole("button", { name: "start" })).toBeTruthy();
});

it("opens the desktop after a successful logon", async () => {
  const api = apiAnswering(loggedOut);
  api.reply("/auth/login", loggedIn, "POST");
  render(createElement(App));
  fireEvent.click(await screen.findByRole("button", { name: "Marguerite" }));
  fireEvent.change(screen.getByLabelText("Type your password"), {
    target: { value: "correct horse" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Log on" }));
  expect(await screen.findByRole("button", { name: "start" })).toBeTruthy();
  expect(
    api.requests.find((request) => request.path === "/auth/login")?.body,
  ).toEqual({ password: "correct horse" });
});
