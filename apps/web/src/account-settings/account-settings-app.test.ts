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
import { loggedIn, stubAuthApi } from "../testing/auth-fixtures.js";
import type { BrowserApi } from "../testing/browser-api.js";
import { App } from "../app.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Boots a logged-in desktop through the app root, which holds the account. */
async function bootDesktop() {
  const api = stubAuthApi(loggedIn);
  render(createElement(App));
  await screen.findByRole("button", { name: "start" });
  return api;
}

/** Opens Account Settings from its desktop shortcut and returns its window. */
async function openFromShortcut() {
  const api = await bootDesktop();
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

/** The profile changes the program sent, to prove a refused form sent none. */
function profileChanges(api: BrowserApi) {
  return api.requests.filter((request) => request.path === "/account");
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
  expect(profileChanges(api)).toHaveLength(0);
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
  expect(profileChanges(api).map((request) => request.body)).toEqual([
    { displayName: "Hortense" },
  ]);
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
  expect(profileChanges(api)).toHaveLength(0);
  expect(
    within(window).getByRole("heading", { name: "Marguerite" }),
  ).toBeTruthy();
});

it("shows a placeholder for the picture and password tasks until they exist", async () => {
  const { window } = await openFromShortcut();
  for (const task of ["Change my picture", "Change my password"]) {
    fireEvent.click(within(window).getByRole("button", { name: task }));
    expect(within(window).getByText(/not available yet/)).toBeTruthy();
    fireEvent.click(within(window).getByRole("button", { name: "Back" }));
  }
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
