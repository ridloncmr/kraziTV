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
import {
  account,
  loggedIn,
  tooManyAttempts,
} from "../testing/auth-fixtures.js";
import { BrowserApi } from "../testing/browser-api.js";
import { elapse } from "../testing/fake-time.js";
import { LogonScreen } from "./logon-screen.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const BALLOON =
  "Did you forget your password? Please type your password again. Be sure to use the correct uppercase and lowercase letters.";

/** Renders the logon screen over `api` and returns the success callback. */
function renderLogon(api: BrowserApi) {
  vi.stubGlobal("fetch", api.fetch);
  const onLoggedIn = vi.fn();
  render(createElement(LogonScreen, { account, onLoggedIn }));
  return onLoggedIn;
}

/** Opens the user tile the way a click or Enter on it does, and types `password`. */
function openAndType(password: string) {
  fireEvent.click(screen.getByRole("button", { name: "Marguerite" }));
  const box = screen.getByLabelText<HTMLInputElement>("Type your password");
  fireEvent.change(box, { target: { value: password } });
  return box;
}

it("offers the tile to the keyboard and moves focus to the password box when it opens", () => {
  renderLogon(new BrowserApi());
  const tile = screen.getByRole("button", { name: "Marguerite" });
  // A native button is in the Tab order and activates on Enter in browsers;
  // the browser suite presses the real keys.
  expect(tile.tagName).toBe("BUTTON");
  expect(tile.tabIndex).toBe(0);
  expect(screen.queryByLabelText("Type your password")).toBeNull();
  fireEvent.click(tile);
  expect(document.activeElement).toBe(
    screen.getByLabelText("Type your password"),
  );
  expect(screen.getByText(/After you log on, you can change/)).toBeTruthy();
});

it("disables the box and the arrow while the login runs, then reports the new state", async () => {
  const api = new BrowserApi();
  api.hold("/auth/login", "POST");
  const onLoggedIn = renderLogon(api);
  const box = openAndType("correct horse");
  fireEvent.submit(box.form!);
  const arrow = screen.getByRole<HTMLButtonElement>("button", {
    name: "Log on",
  });
  await waitFor(() => expect(box.disabled).toBe(true));
  expect(arrow.disabled).toBe(true);
  expect(api.requests.at(-1)).toMatchObject({
    path: "/auth/login",
    method: "POST",
    body: { password: "correct horse" },
  });
  api.release("/auth/login", loggedIn, "POST");
  await waitFor(() => expect(onLoggedIn).toHaveBeenCalledWith(loggedIn));
});

it("shows the balloon tip and clears the box after a wrong password, staying on the screen", async () => {
  const api = new BrowserApi();
  api.reply(
    "/auth/login",
    {
      error: { code: "invalid_password", message: "The password is incorrect" },
    },
    "POST",
    401,
  );
  const onLoggedIn = renderLogon(api);
  const box = openAndType("correct horsf");
  fireEvent.submit(box.form!);
  const balloon = await screen.findByRole("alert");
  expect(balloon.textContent).toBe(BALLOON);
  // The box clears one render after the balloon appears.
  await waitFor(() => expect(box.value).toBe(""));
  expect(box.disabled).toBe(false);
  expect(document.activeElement).toBe(box);
  expect(screen.getByRole("main", { name: "Log on to kraziTV" })).toBeTruthy();
  expect(onLoggedIn).not.toHaveBeenCalled();
});

it("shows any other refusal's message without clearing the box", async () => {
  const api = new BrowserApi();
  api.reply(
    "/auth/login",
    { error: { code: "offline", message: "Unavailable" } },
    "POST",
    503,
  );
  renderLogon(api);
  const box = openAndType("correct horse");
  fireEvent.submit(box.form!);
  expect((await screen.findByRole("alert")).textContent).toBe("Unavailable");
  expect(box.value).toBe("correct horse");
});

it("never reports a login that finishes after the screen unmounts", async () => {
  const api = new BrowserApi();
  api.hold("/auth/login", "POST");
  const onLoggedIn = renderLogon(api);
  fireEvent.submit(openAndType("correct horse").form!);
  await waitFor(() => expect(api.requests.at(-1)?.path).toBe("/auth/login"));
  cleanup();
  api.release("/auth/login", loggedIn, "POST");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(onLoggedIn).not.toHaveBeenCalled();
});

/** A login API that refuses with `429 too_many_attempts`, waiting `retryAfterSeconds` when given. */
function throttledApi(retryAfterSeconds?: number): BrowserApi {
  const api = new BrowserApi();
  api.reply("/auth/login", tooManyAttempts(retryAfterSeconds), "POST", 429);
  return api;
}

it("counts a throttled logon down each second with the box disabled, then re-enables it", async () => {
  vi.useFakeTimers();
  renderLogon(throttledApi(3));
  const box = openAndType("correct horse");
  const arrow = screen.getByRole<HTMLButtonElement>("button", {
    name: "Log on",
  });
  fireEvent.submit(box.form!);
  await elapse(0);
  const balloon = () => screen.getByRole("alert").textContent;
  expect(balloon()).toContain("try again in 3 seconds");
  expect(box.disabled).toBe(true);
  expect(arrow.disabled).toBe(true);
  await elapse(1_000);
  expect(balloon()).toContain("try again in 2 seconds");
  expect(box.disabled).toBe(true);
  await elapse(1_000);
  expect(balloon()).toContain("try again in 1 second.");
  expect(box.disabled).toBe(true);
  expect(arrow.disabled).toBe(true);
  await elapse(1_000);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(box.disabled).toBe(false);
  expect(arrow.disabled).toBe(false);
  expect(document.activeElement).toBe(box);
});

it("leaves no countdown timer running after the screen unmounts", async () => {
  vi.useFakeTimers();
  renderLogon(throttledApi(30));
  fireEvent.submit(openAndType("correct horse").form!);
  await elapse(0);
  expect(vi.getTimerCount()).toBeGreaterThan(0);
  cleanup();
  expect(vi.getTimerCount()).toBe(0);
});

it("shows the server's message and keeps the box usable when the wait is missing", async () => {
  renderLogon(throttledApi());
  const box = openAndType("correct horse");
  fireEvent.submit(box.form!);
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Too many wrong passwords; wait before trying again",
  );
  expect(box.disabled).toBe(false);
});

it("draws the account's own avatar on its tile", () => {
  vi.stubGlobal("fetch", new BrowserApi().fetch);
  render(
    createElement(LogonScreen, {
      account: { ...account, avatarId: "crt-tv" },
      onLoggedIn: vi.fn(),
    }),
  );
  const tile = screen.getByRole("button", { name: "Marguerite" });
  expect(tile.querySelector('[data-avatar="crt-tv"]')).not.toBeNull();
});
