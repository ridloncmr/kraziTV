// @vitest-environment jsdom
import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  loggedIn,
  loggedOut,
  setupRequired,
  stubAuthApi,
} from "./testing/auth-fixtures.js";
import { elapse } from "./testing/fake-time.js";
import { App } from "./app.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const offline = { error: { code: "offline", message: "Unavailable" } };

/** Completes the setup form with a valid name and password and presses Next. */
function fillSetup() {
  for (const [label, value] of [
    ["Your name", "Bartholomew"],
    ["Password", "correct horse"],
    ["Confirm password", "correct horse"],
  ] as const)
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
}

it("boots through the auth state and opens the desktop for a logged-in browser", async () => {
  stubAuthApi(loggedIn);
  render(createElement(App));
  expect(screen.getByLabelText("kraziTV starting")).toBeTruthy();
  expect(await screen.findByRole("button", { name: "start" })).toBeTruthy();
  expect(screen.queryByLabelText("kraziTV starting")).toBeNull();
});

it("keeps the boot screen up for its minimum duration even when the state answers at once", async () => {
  vi.useFakeTimers();
  stubAuthApi(loggedIn);
  render(createElement(App));
  await elapse(600);
  expect(screen.getByLabelText("kraziTV starting")).toBeTruthy();
  await elapse(100);
  expect(screen.queryByLabelText("kraziTV starting")).toBeNull();
  expect(screen.getByRole("button", { name: "start" })).toBeTruthy();
});

it("shows the logon screen with the account's tile when the browser has no session", async () => {
  stubAuthApi(loggedOut);
  render(createElement(App));
  const logon = await screen.findByRole("main", { name: "Log on to kraziTV" });
  expect(
    within(logon).getByRole("button", { name: "Marguerite" }),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "start" })).toBeNull();
});

it("shows the setup screen while the account is not set up and opens the desktop once it is", async () => {
  const api = stubAuthApi(setupRequired);
  api.reply("/auth/setup", loggedIn, "POST", 201);
  render(createElement(App));
  await screen.findByRole("main", { name: "Set up kraziTV" });
  expect(screen.queryByRole("button", { name: "start" })).toBeNull();
  fillSetup();
  expect(await screen.findByRole("button", { name: "start" })).toBeTruthy();
});

it("re-reads the auth state after a 409 and shows the logon screen it names", async () => {
  const api = stubAuthApi(setupRequired);
  api.reply(
    "/auth/setup",
    { error: { code: "already_set_up", message: "Already set up" } },
    "POST",
    409,
  );
  render(createElement(App));
  await screen.findByRole("main", { name: "Set up kraziTV" });
  // Another browser finished setup first, as a different account name.
  api.reply("/auth/state", loggedOut);
  fillSetup();
  expect(
    await screen.findByRole("button", { name: "Marguerite" }),
  ).toBeTruthy();
  expect(api.requestsTo("/auth/state")).toHaveLength(2);
});

it("says the server is unreachable and opens the right screen after Retry", async () => {
  const api = stubAuthApi(offline, 503);
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
  const api = stubAuthApi(offline, 503);
  render(createElement(App));
  await elapse(700);
  expect(screen.getByText("kraziTV can't reach its server.")).toBeTruthy();
  expect(api.requestsTo("/auth/state")).toHaveLength(1);
  await elapse(9_000);
  expect(api.requestsTo("/auth/state")).toHaveLength(1);
  api.reply("/auth/state", loggedIn);
  await elapse(1_000);
  expect(api.requestsTo("/auth/state")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "start" })).toBeTruthy();
});

it("opens the desktop after a successful logon", async () => {
  const api = stubAuthApi(loggedOut);
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
