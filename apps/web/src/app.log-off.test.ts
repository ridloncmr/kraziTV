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
import { loggedIn, stubAuthApi } from "./testing/auth-fixtures.js";
import { App } from "./app.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Boots a logged-in desktop, opens Start, and presses Log Off. */
async function openLogOff() {
  const api = stubAuthApi(loggedIn);
  api.reply("/media-roots", []);
  api.reply("/media-items", { items: [], total: 0 });
  render(createElement(App));
  fireEvent.click(await screen.findByRole("button", { name: "start" }));
  fireEvent.click(
    within(
      screen.getByRole("navigation", { name: "Start programs" }),
    ).getByRole("button", { name: "Log Off" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Log Off kraziTV" });
  return { api, dialog };
}

it("opens a modal confirmation over the whole desktop with focus on Log Off", async () => {
  const { dialog } = await openLogOff();
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  expect(document.activeElement).toBe(
    within(dialog).getByRole("button", { name: "Log Off" }),
  );
  expect(
    screen.queryByRole("navigation", { name: "Start programs" }),
  ).toBeNull();
  // The desktop behind it takes no input while it is open.
  expect(document.querySelector(".desktop-shell")?.hasAttribute("inert")).toBe(
    true,
  );
});

it("logs off through the server and shows the logon screen", async () => {
  const { api, dialog } = await openLogOff();
  api.reply("/auth/logout", undefined, "POST", 204);
  fireEvent.click(within(dialog).getByRole("button", { name: "Log Off" }));
  expect(
    await screen.findByRole("button", { name: "Marguerite" }),
  ).toBeTruthy();
  expect(api.requestsTo("/auth/logout")).toHaveLength(1);
  expect(api.requestsTo("/auth/logout")[0]?.method).toBe("POST");
  expect(screen.queryByRole("button", { name: "start" })).toBeNull();
  // The answer names the screen; no state re-read is needed.
  expect(api.requestsTo("/auth/state")).toHaveLength(1);
});

it("changes nothing on Cancel and returns focus to Start", async () => {
  const { api, dialog } = await openLogOff();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog", { name: "Log Off kraziTV" })).toBeNull();
  expect(api.requestsTo("/auth/logout")).toHaveLength(0);
  const start = screen.getByRole("button", { name: "start" });
  expect(document.activeElement).toBe(start);
  expect(document.querySelector(".desktop-shell")?.hasAttribute("inert")).toBe(
    false,
  );
});

it("closes on Escape like Cancel", async () => {
  const { api, dialog } = await openLogOff();
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "Log Off kraziTV" })).toBeNull();
  expect(api.requestsTo("/auth/logout")).toHaveLength(0);
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "start" }),
  );
});

it("keeps the desktop and the confirmation open when the logout fails", async () => {
  const { api, dialog } = await openLogOff();
  api.reply(
    "/auth/logout",
    { error: { code: "offline", message: "Unavailable" } },
    "POST",
    503,
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Log Off" }));
  expect((await within(dialog).findByRole("alert")).textContent).toBe(
    "kraziTV couldn't log off. Check the connection and try again.",
  );
  expect(screen.getByRole("dialog", { name: "Log Off kraziTV" })).toBe(dialog);
  expect(screen.getByRole("button", { name: "start" })).toBeTruthy();
});

it("cannot be dismissed while the logout runs", async () => {
  const { api, dialog } = await openLogOff();
  api.hold("/auth/logout", "POST");
  const logOff = within(dialog).getByRole<HTMLButtonElement>("button", {
    name: "Log Off",
  });
  fireEvent.click(logOff);
  await waitFor(() => expect(logOff.disabled).toBe(true));
  expect(
    within(dialog).getByRole<HTMLButtonElement>("button", { name: "Cancel" })
      .disabled,
  ).toBe(true);
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.getByRole("dialog", { name: "Log Off kraziTV" })).toBe(dialog);
});
