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
import {
  loggedIn,
  loggedOut,
  setupRequired,
  stubAuthApi,
} from "./testing/auth-fixtures.js";
import type { BrowserApi } from "./testing/browser-api.js";
import { App } from "./app.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const unauthenticated = {
  error: { code: "unauthenticated", message: "Log in first" },
};

/** How many times the app has read `GET /auth/state`. */
function stateReads(api: BrowserApi): number {
  return api.requests.filter((request) => request.path === "/auth/state")
    .length;
}

/** Boots a logged-in desktop and returns the API, ready to open a program. */
async function openDesktop() {
  const api = stubAuthApi(loggedIn);
  render(createElement(App));
  await screen.findByRole("button", { name: "start" });
  return api;
}

/** Opens Media Library from its desktop shortcut; it reads roots and items at once. */
function openMediaLibrary() {
  fireEvent.click(
    within(screen.getByLabelText("Desktop programs")).getByRole("button", {
      name: "Media Library",
    }),
  );
}

it("closes every program and shows the logon screen once, however many reads answer 401", async () => {
  const api = await openDesktop();
  api.reply("/media-roots", unauthenticated, "GET", 401);
  api.reply("/media-items", unauthenticated, "GET", 401);
  api.reply("/auth/state", loggedOut);
  openMediaLibrary();
  expect(
    await screen.findByRole("button", { name: "Marguerite" }),
  ).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Media Library" })).toBeNull();
  expect(screen.queryByRole("button", { name: "start" })).toBeNull();
  // Both of Media Library's reads answered 401; the state was read once more.
  expect(
    api.requests.filter((request) =>
      ["/media-roots", "/media-items"].includes(request.path),
    ),
  ).toHaveLength(2);
  expect(stateReads(api)).toBe(2);
});

it("shows the setup screen when the re-read says the account is gone", async () => {
  const api = await openDesktop();
  api.reply("/media-roots", unauthenticated, "GET", 401);
  api.reply("/media-items", { items: [], total: 0 });
  api.reply("/auth/state", setupRequired);
  openMediaLibrary();
  expect(
    await screen.findByRole("main", { name: "Set up kraziTV" }),
  ).toBeTruthy();
});

it("ignores a late 401 from the closed desktop once the logon screen is up", async () => {
  const api = await openDesktop();
  api.reply("/media-roots", unauthenticated, "GET", 401);
  api.hold("/media-items");
  api.reply("/auth/state", loggedOut);
  openMediaLibrary();
  const tile = await screen.findByRole("button", { name: "Marguerite" });
  fireEvent.click(tile);
  const box = screen.getByLabelText<HTMLInputElement>("Type your password");
  fireEvent.change(box, { target: { value: "half typed" } });
  // The unmounted program's aborted read still comes back 401.
  api.release("/media-items", unauthenticated, "GET", 401);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(stateReads(api)).toBe(2);
  expect(
    screen.getByLabelText<HTMLInputElement>("Type your password").value,
  ).toBe("half typed");
});

it("ignores a 401 that answers after the re-read has started", async () => {
  const api = await openDesktop();
  api.reply("/media-roots", unauthenticated, "GET", 401);
  api.hold("/media-items");
  api.hold("/auth/state");
  openMediaLibrary();
  await waitFor(() => expect(stateReads(api)).toBe(2));
  api.release("/media-items", unauthenticated, "GET", 401);
  api.release("/auth/state", loggedOut);
  expect(
    await screen.findByRole("button", { name: "Marguerite" }),
  ).toBeTruthy();
  expect(stateReads(api)).toBe(2);
});

it("leaves a wrong password on the logon screen to the logon screen", async () => {
  const api = stubAuthApi(loggedOut);
  api.reply(
    "/auth/login",
    {
      error: { code: "invalid_password", message: "The password is incorrect" },
    },
    "POST",
    401,
  );
  render(createElement(App));
  fireEvent.click(await screen.findByRole("button", { name: "Marguerite" }));
  fireEvent.change(screen.getByLabelText("Type your password"), {
    target: { value: "correct horsf" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Log on" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Did you forget your password?",
  );
  expect(stateReads(api)).toBe(1);
  expect(screen.getByRole("main", { name: "Log on to kraziTV" })).toBeTruthy();
});

it("does not loop when the state read itself answers 401", async () => {
  const api = stubAuthApi(unauthenticated, 401);
  render(createElement(App));
  expect(
    await screen.findByText("kraziTV can't reach its server."),
  ).toBeTruthy();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(stateReads(api)).toBe(1);
});
