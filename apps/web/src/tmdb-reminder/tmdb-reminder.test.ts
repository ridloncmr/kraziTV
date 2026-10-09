// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { bootDesktop } from "../testing/auth-fixtures.js";
import type { BrowserApi } from "../testing/browser-api.js";
import { mediaRoot } from "../testing/scan-fixtures.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const STORAGE_KEY = "krazitv.tmdbReminder";
const DAY_MS = 24 * 60 * 60 * 1_000;

/** Boots the desktop with the server reporting `configured` and `roots`. */
async function boot({
  configured = false,
  roots = [mediaRoot({ id: "root-1", path: "D:/Media" })],
}: { configured?: boolean; roots?: unknown[] } = {}) {
  const api = await bootDesktop(undefined, (scripted: BrowserApi) => {
    scripted.reply("/metadata/tmdb-key", { configured });
    scripted.reply("/media-roots", roots);
  });
  // Both reads settle before the reminder decides.
  await vi.waitFor(() => {
    expect(api.requestsTo("/metadata/tmdb-key")).not.toHaveLength(0);
    expect(api.requestsTo("/media-roots")).not.toHaveLength(0);
  });
  return api;
}

/** The tray icon, found by the label the spec gives it. */
const trayIcon = () =>
  within(screen.getByRole("contentinfo")).queryByRole("button", {
    name: "TMDB isn't set up",
  });

/** The balloon, or null while it is closed. */
const balloon = () =>
  screen.queryByRole("dialog", { name: "TMDB isn't set up" });

/** Reads the stored reminder state, as the next desktop start would. */
const stored = () =>
  JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as unknown;

it("opens the balloon by itself with no key, a media root, and no stored state", async () => {
  await boot();

  expect(
    await screen.findByRole("dialog", { name: "TMDB isn't set up" }),
  ).toBeTruthy();
  expect(
    within(balloon()!).getByText(
      "kraziTV can only read titles from file names. Set up TMDB to look up series, episodes, and movies.",
    ),
  ).toBeTruthy();
  expect(trayIcon()).toBeTruthy();
});

it("shows only the tray icon when no media root exists", async () => {
  await boot({ roots: [] });

  expect(
    await screen.findByRole("button", { name: "TMDB isn't set up" }),
  ).toBeTruthy();
  expect(balloon()).toBeNull();
});

it("shows neither icon nor balloon when a key is set", async () => {
  await boot({ configured: true });

  await vi.waitFor(() => expect(trayIcon()).toBeNull());
  expect(balloon()).toBeNull();
});

it.each([
  ["a snooze that has not ended", { remindAfter: Date.now() + DAY_MS }],
  ["Don't remind me", { never: true }],
])(
  "keeps the balloon closed after %s, but the icon opens it",
  async (_, state) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    await boot();

    fireEvent.click(
      await screen.findByRole("button", { name: "TMDB isn't set up" }),
    );

    expect(balloon()).toBeTruthy();
  },
);

it("opens the balloon again once a snooze has ended", async () => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ remindAfter: Date.now() - 1 }),
  );
  await boot();

  expect(
    await screen.findByRole("dialog", { name: "TMDB isn't set up" }),
  ).toBeTruthy();
});

it("treats unreadable stored state as due", async () => {
  localStorage.setItem(STORAGE_KEY, "{not json");
  await boot();

  expect(
    await screen.findByRole("dialog", { name: "TMDB isn't set up" }),
  ).toBeTruthy();
});

it.each(["Remind me later", "Close"])(
  "%s closes the balloon and snoozes it for 7 days",
  async (action) => {
    await boot();
    const before = Date.now();

    fireEvent.click(
      within(
        await screen.findByRole("dialog", { name: "TMDB isn't set up" }),
      ).getByRole("button", { name: action }),
    );

    expect(balloon()).toBeNull();
    const { remindAfter } = stored() as { remindAfter: number };
    expect(remindAfter).toBeGreaterThanOrEqual(before + 7 * DAY_MS);
    expect(remindAfter).toBeLessThanOrEqual(Date.now() + 7 * DAY_MS);
    expect(trayIcon()).toBeTruthy();
  },
);

it("Don't remind me closes the balloon for good but keeps the icon", async () => {
  await boot();

  fireEvent.click(
    within(
      await screen.findByRole("dialog", { name: "TMDB isn't set up" }),
    ).getByRole("button", { name: "Don't remind me" }),
  );

  expect(balloon()).toBeNull();
  expect(stored()).toEqual({ never: true });
  expect(trayIcon()).toBeTruthy();
});

it("Set up TMDB opens Account Settings on the task, and a saved key removes the icon", async () => {
  const api = await boot();
  fireEvent.click(
    within(
      await screen.findByRole("dialog", { name: "TMDB isn't set up" }),
    ).getByRole("button", { name: "Set up TMDB" }),
  );

  const window = screen.getByRole("region", { name: "Account Settings" });
  expect(
    await within(window).findByLabelText("API Read Access Token"),
  ).toBeTruthy();
  expect(balloon()).toBeNull();
  expect(stored()).toMatchObject({ remindAfter: expect.any(Number) });

  api.reply("/metadata/tmdb-key", { configured: true }, "PUT");
  api.reply("/metadata/tmdb-key", { configured: true });
  fireEvent.change(within(window).getByLabelText("API Read Access Token"), {
    target: { value: "eyJ.token.sig" },
  });
  fireEvent.click(within(window).getByRole("button", { name: "Save" }));

  await vi.waitFor(() => expect(trayIcon()).toBeNull());
});

it("opens Account Settings at home after a tray request was cancelled and the window closed", async () => {
  await boot();
  fireEvent.click(
    within(
      await screen.findByRole("dialog", { name: "TMDB isn't set up" }),
    ).getByRole("button", { name: "Set up TMDB" }),
  );
  await screen.findByLabelText("API Read Access Token");
  fireEvent.click(
    screen.getByRole("button", { name: "Close Account Settings" }),
  );

  fireEvent.click(
    within(screen.getByLabelText("Desktop programs")).getByRole("button", {
      name: "Account Settings",
    }),
  );

  const window = screen.getByRole("region", { name: "Account Settings" });
  expect(
    within(window).getByRole("button", { name: "Set up TMDB" }),
  ).toBeTruthy();
  expect(within(window).queryByLabelText("API Read Access Token")).toBeNull();
});

it("keeps the balloon closed when a removed key brings the icon back after Don't remind me", async () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ never: true }));
  const api = await boot();
  fireEvent.click(
    await screen.findByRole("button", { name: "TMDB isn't set up" }),
  );
  expect(balloon()).toBeTruthy();

  // Saved from Account Settings directly, not from the balloon.
  fireEvent.click(
    within(screen.getByLabelText("Desktop programs")).getByRole("button", {
      name: "Account Settings",
    }),
  );
  const window = screen.getByRole("region", { name: "Account Settings" });
  fireEvent.click(within(window).getByRole("button", { name: "Set up TMDB" }));
  api.reply("/metadata/tmdb-key", { configured: true }, "PUT");
  api.reply("/metadata/tmdb-key", { configured: true });
  fireEvent.change(
    await within(window).findByLabelText("API Read Access Token"),
    { target: { value: "eyJ.token.sig" } },
  );
  fireEvent.click(within(window).getByRole("button", { name: "Save" }));
  await vi.waitFor(() => expect(trayIcon()).toBeNull());

  // The key reads as set until the DELETE lands, so the task offers Remove.
  api.handle(
    "/metadata/tmdb-key",
    () => {
      api.reply("/metadata/tmdb-key", { configured: false });
      return api.response({ configured: false });
    },
    "DELETE",
  );
  fireEvent.click(
    await within(window).findByRole("button", { name: "Set up TMDB" }),
  );
  fireEvent.click(
    await within(window).findByRole("button", { name: "Remove" }),
  );

  await vi.waitFor(() => expect(trayIcon()).toBeTruthy());
  expect(balloon()).toBeNull();
});

it("closes on Escape, snoozing as Close does, and the icon reports whether it is open", async () => {
  await boot({ roots: [] });
  const icon = await screen.findByRole("button", { name: "TMDB isn't set up" });
  expect(icon.getAttribute("aria-expanded")).toBe("false");

  fireEvent.click(icon);
  expect(icon.getAttribute("aria-expanded")).toBe("true");
  // Opened on request, so focus moves into it.
  expect(document.activeElement?.textContent).toBe("Set up TMDB");
  fireEvent.keyDown(balloon()!, { key: "Escape" });

  expect(balloon()).toBeNull();
  expect(stored()).toMatchObject({ remindAfter: expect.any(Number) });
});
