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
import { account, loggedIn, stubAuthApi } from "../testing/auth-fixtures.js";
import type { BrowserApi } from "../testing/browser-api.js";
import type { AuthState } from "../http/contracts.js";
import { App } from "../app.js";
import { AVATAR_IDS } from "../branding/avatars/account-picture.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Boots a logged-in desktop through the app root, which holds the account. */
async function bootDesktop(state: AuthState = loggedIn) {
  const api = stubAuthApi(state);
  render(createElement(App));
  await screen.findByRole("button", { name: "start" });
  return api;
}

/** Opens Account Settings from its desktop shortcut and returns its window. */
async function openFromShortcut(state?: AuthState) {
  const api = await bootDesktop(state);
  fireEvent.click(
    within(screen.getByLabelText("Desktop programs")).getByRole("button", {
      name: "Account Settings",
    }),
  );
  const window = screen.getByRole("region", { name: "Account Settings" });
  return { api, window };
}

/** Opens the name view, types `name`, and presses Change Name. */
function submitName(window: HTMLElement, name: string) {
  fireEvent.click(
    within(window).getByRole("button", { name: "Change my name" }),
  );
  fireEvent.change(within(window).getByLabelText("Type a new name"), {
    target: { value: name },
  });
  fireEvent.click(within(window).getByRole("button", { name: "Change Name" }));
}

/** The changes the program sent to `path`, to prove a refused form sent none. */
function changesSentTo(api: BrowserApi, path: string) {
  return api.requests.filter((request) => request.path === path);
}

/** Advances fake time and lets React apply what the timers changed. */
function elapse(ms: number) {
  return act(() => vi.advanceTimersByTimeAsync(ms));
}

it("opens from the desktop shortcut showing the account and its three tasks", async () => {
  const { window } = await openFromShortcut();
  expect(
    within(window).getByRole("heading", { name: "Marguerite" }),
  ).toBeTruthy();
  for (const task of [
    "Change my name",
    "Change my picture",
    "Change my password",
  ])
    expect(within(window).getByRole("button", { name: task })).toBeTruthy();
  // Every place that names the program draws the account's picture instead.
  expect(
    window.querySelector(".title-bar .account-picture [data-avatar='duck']"),
  ).not.toBeNull();
  const taskbar = screen.getByRole("navigation", { name: "Open programs" });
  expect(
    within(taskbar)
      .getByRole("button", { name: "Account Settings" })
      .querySelector("[data-avatar='duck']"),
  ).not.toBeNull();
  expect(
    within(screen.getByLabelText("Desktop programs"))
      .getByRole("button", { name: "Account Settings" })
      .querySelector("[data-avatar='duck']"),
  ).not.toBeNull();
});

it("opens from Start, whose entry draws the account's picture", async () => {
  await bootDesktop();
  fireEvent.click(screen.getByRole("button", { name: "start" }));
  const entry = within(
    screen.getByRole("navigation", { name: "Start programs" }),
  ).getByRole("button", { name: /Account Settings/ });
  expect(entry.querySelector("[data-avatar='duck']")).not.toBeNull();
  fireEvent.click(entry);
  const window = screen.getByRole("region", { name: "Account Settings" });
  expect(
    within(window).getByRole("heading", { name: "Marguerite" }),
  ).toBeTruthy();
});

it.each([
  { refusal: "a blank name", name: "   ", says: "Type your name." },
  {
    refusal: "a 41-character name",
    name: "n".repeat(41),
    says: "Your name must be 40 characters or fewer.",
  },
])("refuses $refusal without sending it", async ({ name, says }) => {
  const { api, window } = await openFromShortcut();
  submitName(window, name);
  expect(within(window).getByRole("alert").textContent).toBe(says);
  expect(changesSentTo(api, "/account")).toHaveLength(0);
});

it("starts the name box filled with the current name", async () => {
  const { window } = await openFromShortcut();
  fireEvent.click(
    within(window).getByRole("button", { name: "Change my name" }),
  );
  expect(
    within(window).getByLabelText<HTMLInputElement>("Type a new name").value,
  ).toBe("Marguerite");
});

it("sends the trimmed name, shows the answer, and returns home", async () => {
  const { api, window } = await openFromShortcut();
  api.handle(
    "/account",
    () => api.response({ displayName: "Hortense", avatarId: "duck" }),
    "PATCH",
  );
  submitName(window, "  Hortense  ");
  expect(
    await within(window).findByRole("heading", { name: "Hortense" }),
  ).toBeTruthy();
  expect(changesSentTo(api, "/account").map((request) => request.body)).toEqual(
    [{ displayName: "Hortense" }],
  );
  expect(within(window).queryByLabelText("Type a new name")).toBeNull();
});

it("shows the server's refusal and stays on the name view", async () => {
  const { api, window } = await openFromShortcut();
  api.reply(
    "/account",
    { error: { code: "invalid_request", message: "Name refused" } },
    "PATCH",
    400,
  );
  submitName(window, "Hortense");
  expect((await within(window).findByRole("alert")).textContent).toBe(
    "Name refused",
  );
  expect(within(window).getByLabelText("Type a new name")).toBeTruthy();
});

it("disables the name form while the change is pending", async () => {
  const { api, window } = await openFromShortcut();
  api.hold("/account", "PATCH");
  submitName(window, "Hortense");
  const button = within(window).getByRole("button", { name: "Change Name" });
  // The fieldset disables every field; :disabled is what the browser applies.
  await waitFor(() => expect(button.matches(":disabled")).toBe(true));
  expect(
    within(window).getByLabelText("Type a new name").matches(":disabled"),
  ).toBe(true);
});

it("sends nothing on Cancel and returns home", async () => {
  const { api, window } = await openFromShortcut();
  fireEvent.click(
    within(window).getByRole("button", { name: "Change my name" }),
  );
  fireEvent.change(within(window).getByLabelText("Type a new name"), {
    target: { value: "Hortense" },
  });
  fireEvent.click(within(window).getByRole("button", { name: "Cancel" }));
  expect(changesSentTo(api, "/account")).toHaveLength(0);
  expect(
    within(window).getByRole("heading", { name: "Marguerite" }),
  ).toBeTruthy();
});

/** Opens the password view and fills its three boxes. */
function fillPassword(
  window: HTMLElement,
  current: string,
  next: string,
  confirm = next,
) {
  fireEvent.click(
    within(window).getByRole("button", { name: "Change my password" }),
  );
  for (const [label, value] of [
    ["Current password", current],
    ["New password", next],
    ["Confirm new password", confirm],
  ])
    fireEvent.change(within(window).getByLabelText(label), {
      target: { value },
    });
}

/** Presses Change Password and returns the button. */
function submitPassword(window: HTMLElement) {
  const button = within(window).getByRole<HTMLButtonElement>("button", {
    name: "Change Password",
  });
  fireEvent.click(button);
  return button;
}

/** The password box with this label, for reading its value. */
function passwordBox(window: HTMLElement, label: string) {
  return within(window).getByLabelText<HTMLInputElement>(label);
}

it.each([
  {
    refusal: "a 7-character new password",
    next: "seven77",
    confirm: "seven77",
    says: "Your password must be at least 8 characters.",
  },
  {
    refusal: "a mismatched confirmation",
    next: "correct horse",
    confirm: "correct horsf",
    says: "The passwords you typed do not match.",
  },
])("refuses $refusal without sending it", async ({ next, confirm, says }) => {
  const { api, window } = await openFromShortcut();
  fillPassword(window, "old password", next, confirm);
  submitPassword(window);
  expect(within(window).getByRole("alert").textContent).toBe(says);
  expect(changesSentTo(api, "/account/password")).toHaveLength(0);
});

it("disables the password form while the change is pending", async () => {
  const { api, window } = await openFromShortcut();
  api.hold("/account/password", "PUT");
  fillPassword(window, "old password", "correct horse");
  const button = submitPassword(window);
  await waitFor(() => expect(button.matches(":disabled")).toBe(true));
  expect(passwordBox(window, "Current password").matches(":disabled")).toBe(
    true,
  );
});

it("shows a wrong current password and clears only that box, keeping the desktop", async () => {
  const { api, window } = await openFromShortcut();
  api.reply(
    "/account/password",
    {
      error: {
        code: "invalid_password",
        message: "The current password is incorrect",
      },
    },
    "PUT",
    400,
  );
  fillPassword(window, "wrong password", "correct horse");
  submitPassword(window);
  expect((await within(window).findByRole("alert")).textContent).toBe(
    "The password you typed is incorrect.",
  );
  const current = passwordBox(window, "Current password");
  expect(current.value).toBe("");
  expect(document.activeElement).toBe(current);
  expect(passwordBox(window, "New password").value).toBe("correct horse");
  expect(passwordBox(window, "Confirm new password").value).toBe(
    "correct horse",
  );
  expect(screen.getByRole("button", { name: "start" })).toBeTruthy();
});

it("counts a throttled change down each second with Change Password disabled, then re-enables it", async () => {
  const { api, window } = await openFromShortcut();
  api.reply(
    "/account/password",
    {
      error: {
        code: "too_many_attempts",
        message: "Too many wrong passwords; wait before trying again",
        retryAfterSeconds: 3,
      },
    },
    "PUT",
    429,
  );
  vi.useFakeTimers();
  fillPassword(window, "old password", "correct horse");
  const button = submitPassword(window);
  await elapse(0);
  const alert = () => within(window).queryByRole("alert")?.textContent;
  expect(alert()).toContain("try again in 3 seconds");
  expect(button.disabled).toBe(true);
  await elapse(1_000);
  expect(alert()).toContain("try again in 2 seconds");
  expect(button.disabled).toBe(true);
  await elapse(1_000);
  expect(alert()).toContain("try again in 1 second.");
  expect(button.disabled).toBe(true);
  await elapse(1_000);
  expect(alert()).toBeUndefined();
  expect(button.disabled).toBe(false);
});

it("sends the change, then returns home", async () => {
  const { api, window } = await openFromShortcut();
  api.reply("/account/password", undefined, "PUT", 204);
  fillPassword(window, "old password", "correct horse");
  submitPassword(window);
  expect(
    await within(window).findByRole("button", { name: "Change my password" }),
  ).toBeTruthy();
  expect(
    changesSentTo(api, "/account/password").map((request) => request.body),
  ).toEqual([
    { currentPassword: "old password", newPassword: "correct horse" },
  ]);
  expect(within(window).queryByLabelText("Current password")).toBeNull();
});

it("sends no password on Cancel and returns home", async () => {
  const { api, window } = await openFromShortcut();
  fillPassword(window, "old password", "correct horse");
  fireEvent.click(within(window).getByRole("button", { name: "Cancel" }));
  expect(changesSentTo(api, "/account/password")).toHaveLength(0);
  expect(
    within(window).getByRole("heading", { name: "Marguerite" }),
  ).toBeTruthy();
});

/** Opens the picture view, whose options are named by their avatar IDs. */
function openPicker(window: HTMLElement) {
  fireEvent.click(
    within(window).getByRole("button", { name: "Change my picture" }),
  );
  return within(window).getByRole("radiogroup", { name: "Pick a new picture" });
}

/** The avatar each place that names the program draws, outside the picker. */
function programIconAvatars(window: HTMLElement) {
  const avatarIn = (element: Element) =>
    element.querySelector("[data-avatar]")?.getAttribute("data-avatar");
  return [
    avatarIn(window.querySelector(".title-bar")!),
    avatarIn(
      within(
        screen.getByRole("navigation", { name: "Open programs" }),
      ).getByRole("button", { name: "Account Settings" }),
    ),
    avatarIn(
      within(screen.getByLabelText("Desktop programs")).getByRole("button", {
        name: "Account Settings",
      }),
    ),
  ];
}

it("starts the picker with the current picture selected among every avatar", async () => {
  // Not the first avatar, so a picker that checks the first option fails.
  const { window } = await openFromShortcut({
    ...loggedIn,
    account: { ...account, avatarId: "guitar" },
  });
  const picker = openPicker(window);
  const options = within(picker).getAllByRole<HTMLInputElement>("radio");
  expect(options.map((option) => option.getAttribute("aria-label"))).toEqual(
    AVATAR_IDS,
  );
  expect(
    options.filter((option) => option.checked).map((option) => option.value),
  ).toEqual(["guitar"]);
});

it("sends the chosen picture, redraws the program icon, and returns home", async () => {
  const { api, window } = await openFromShortcut();
  api.handle(
    "/account",
    () => api.response({ displayName: "Marguerite", avatarId: "popcorn" }),
    "PATCH",
  );
  const picker = openPicker(window);
  fireEvent.click(within(picker).getByRole("radio", { name: "popcorn" }));
  fireEvent.click(
    within(window).getByRole("button", { name: "Change Picture" }),
  );
  await waitFor(() =>
    expect(programIconAvatars(window)).toEqual([
      "popcorn",
      "popcorn",
      "popcorn",
    ]),
  );
  expect(changesSentTo(api, "/account").map((request) => request.body)).toEqual(
    [{ avatarId: "popcorn" }],
  );
  expect(within(window).queryByRole("radiogroup")).toBeNull();
  expect(
    window.querySelector(".account-settings-header [data-avatar='popcorn']"),
  ).not.toBeNull();
});

it("sends no picture on Cancel and returns home", async () => {
  const { api, window } = await openFromShortcut();
  const picker = openPicker(window);
  fireEvent.click(within(picker).getByRole("radio", { name: "popcorn" }));
  fireEvent.click(within(window).getByRole("button", { name: "Cancel" }));
  expect(changesSentTo(api, "/account")).toHaveLength(0);
  expect(within(window).queryByRole("radiogroup")).toBeNull();
  expect(programIconAvatars(window)).toEqual(["duck", "duck", "duck"]);
});

it("shows the server's unknown_avatar message and stays on the picker", async () => {
  const { api, window } = await openFromShortcut();
  api.reply(
    "/account",
    { error: { code: "unknown_avatar", message: "That picture is unknown." } },
    "PATCH",
    400,
  );
  const picker = openPicker(window);
  fireEvent.click(within(picker).getByRole("radio", { name: "popcorn" }));
  fireEvent.click(
    within(window).getByRole("button", { name: "Change Picture" }),
  );
  expect((await within(window).findByRole("alert")).textContent).toBe(
    "That picture is unknown.",
  );
  expect(within(window).getByRole("radiogroup")).toBeTruthy();
  expect(programIconAvatars(window)).toEqual(["duck", "duck", "duck"]);
});

it("shows the new name on the logon screen after logging off, without a re-read", async () => {
  const { api, window } = await openFromShortcut();
  api.handle(
    "/account",
    () => api.response({ displayName: "Hortense", avatarId: "duck" }),
    "PATCH",
  );
  api.reply("/auth/logout", undefined, "POST", 204);
  submitName(window, "Hortense");
  await within(window).findByRole("heading", { name: "Hortense" });
  fireEvent.click(screen.getByRole("button", { name: "start" }));
  fireEvent.click(
    within(
      screen.getByRole("navigation", { name: "Start programs" }),
    ).getByRole("button", { name: "Log Off" }),
  );
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Log Off kraziTV" })).getByRole(
      "button",
      { name: "Log Off" },
    ),
  );
  expect(await screen.findByRole("button", { name: "Hortense" })).toBeTruthy();
  expect(
    api.requests.filter((request) => request.path === "/auth/state"),
  ).toHaveLength(1);
});
