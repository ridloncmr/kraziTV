// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  bootDesktop,
  openShortcut,
  renderDesktopShell,
} from "../testing/auth-fixtures.js";
import { BrowserApi } from "../testing/browser-api.js";
import { elapse } from "../testing/fake-time.js";
import { regainFocus } from "../testing/regain-focus.js";
import {
  idleRoot,
  lookingUpRoot,
  mediaRoot,
} from "../testing/scan-fixtures.js";
import { trayIcon } from "../testing/tray-queries.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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
  expect(trayIcon("TMDB isn't set up")).toBeTruthy();
});

it("shows Gregg beside the title with his quip under it, and his head as the tray icon", async () => {
  await boot();

  const opened = await screen.findByRole("dialog", {
    name: "TMDB isn't set up",
  });
  const head = opened.querySelector<HTMLElement>(".tray-balloon-head")!;
  expect(within(head).getByRole("img", { name: "Gregg" })).toBeTruthy();
  expect(head.querySelector(".gregg-smoke")).not.toBeNull();
  const title = within(head).getByText("TMDB isn't set up");
  const quip = within(head).getByText(
    "Right now I'm reading titles off file names. Nobody should live like this.",
  );
  expect(
    title.compareDocumentPosition(quip) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  // The plain sentence, not the quip, still describes the balloon.
  expect(
    document.getElementById(opened.getAttribute("aria-describedby")!)
      ?.textContent,
  ).toBe(
    "kraziTV can only read titles from file names. Set up TMDB to look up series, episodes, and movies.",
  );
  expect(
    trayIcon("TMDB isn't set up")!
      .querySelector("svg")!
      .getAttribute("viewBox"),
  ).toBe("0 0 16 16");
});

it("opens the balloon by itself when the first media root appears mid-session, without taking focus", async () => {
  const api = await boot({ roots: [] });
  await screen.findByRole("button", { name: "TMDB isn't set up" });
  expect(balloon()).toBeNull();
  const focused = document.activeElement;

  api.reply("/media-roots", [mediaRoot({ id: "root-1", path: "D:/Media" })]);
  regainFocus();

  const opened = await screen.findByRole("dialog", {
    name: "TMDB isn't set up",
  });
  expect(opened.contains(document.activeElement)).toBe(false);
  expect(document.activeElement).toBe(focused);
});

it("opens by itself at most once per desktop start, even when its condition stops and holds again", async () => {
  const api = await boot();
  await screen.findByRole("dialog", { name: "TMDB isn't set up" });

  // The owner never answers; a key set elsewhere closes it unrecorded.
  api.reply("/metadata/tmdb-key", { configured: true });
  regainFocus();
  await vi.waitFor(() => expect(trayIcon("TMDB isn't set up")).toBeNull());
  expect(stored()).toBeNull();

  // The key goes again: the icon returns, but the balloon has had its turn.
  api.reply("/metadata/tmdb-key", { configured: false });
  regainFocus();
  await screen.findByRole("button", { name: "TMDB isn't set up" });
  expect(balloon()).toBeNull();
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

  await vi.waitFor(() => expect(trayIcon("TMDB isn't set up")).toBeNull());
  expect(balloon()).toBeNull();
});

it.each([
  ["a snooze that has not ended", { remindAfter: Date.now() + DAY_MS }],
  // Stored by the balloon before it became a tray reminder, under the same key.
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
    expect(trayIcon("TMDB isn't set up")).toBeTruthy();
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
  expect(trayIcon("TMDB isn't set up")).toBeTruthy();
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

  await vi.waitFor(() => expect(trayIcon("TMDB isn't set up")).toBeNull());
});

it("keeps TMDB isn't set up and opens no other balloon while a saved key's lookup starts, then follows it", async () => {
  vi.useFakeTimers();
  const api = new BrowserApi();
  api.reply("/health", { status: "ok" });
  api.reply("/metadata/tmdb-key", { configured: false });
  // A first run: the catalog scan has left files no lookup has searched for.
  api.reply("/media-roots", [idleRoot("root", 12)]);
  api.reply("/media-collections/recommendations", []);
  renderDesktopShell(api);
  await elapse(0);
  fireEvent.click(
    within(balloon()!).getByRole("button", { name: "Set up TMDB" }),
  );
  await elapse(0);
  const window = screen.getByRole("region", { name: "Account Settings" });
  api.reply("/metadata/tmdb-key", { configured: true }, "PUT");
  api.reply("/metadata/tmdb-key", { configured: true });
  api.hold("/metadata/lookup-retries", "POST");
  fireEvent.change(within(window).getByLabelText("API Read Access Token"), {
    target: { value: "eyJ.token.sig" },
  });
  fireEvent.click(within(window).getByRole("button", { name: "Save" }));
  await elapse(0);
  expect(api.requestsTo("/metadata/lookup-retries")).toHaveLength(1);

  // The key is saved, but its lookup has not started: no files reminder.
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(trayIcon("TMDB isn't set up")).toBeTruthy();

  // The lookup starts; the roots that show its job are slow to answer.
  api.hold("/media-roots");
  api.release(
    "/metadata/lookup-retries",
    { lookupCount: 12, busyRootCount: 0 },
    "POST",
    202,
  );
  await elapse(0);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(trayIcon()?.getAttribute("aria-label")).toBe("TMDB isn't set up");

  api.release("/media-roots", [lookingUpRoot("root", 0, 12)]);
  api.reply("/media-roots", [lookingUpRoot("root", 0, 12)]);
  await elapse(0);
  expect(trayIcon()?.getAttribute("aria-label")).toBe(
    "Looking up files on TMDB: 0 of 12",
  );
  expect(screen.queryByRole("dialog")).toBeNull();

  // The jobs end with files left over, as when a busy root was skipped.
  api.reply("/media-roots", [idleRoot("root", 3)]);
  await elapse(3_000);
  expect(screen.getAllByRole("dialog")).toEqual([
    screen.getByRole("dialog", {
      name: "3 files haven't been looked up on TMDB",
    }),
  ]);
});

it.each([
  [
    "refused",
    409,
    "tmdb_key_required",
    "Set up TMDB in Account Settings first.",
  ],
  ["fails", 500, "internal_error", "Internal server error"],
])(
  "still reports a saved key to the tray when its lookup is %s",
  async (_, status, code, message) => {
    const api = await boot({ roots: [idleRoot("root", 12)] });
    const window = openShortcut("Account Settings");
    fireEvent.click(
      within(window).getByRole("button", { name: "Set up TMDB" }),
    );
    api.reply("/metadata/tmdb-key", { configured: true }, "PUT");
    api.reply("/metadata/tmdb-key", { configured: true });
    api.reply(
      "/metadata/lookup-retries",
      { error: { code, message } },
      "POST",
      status,
    );
    fireEvent.change(
      await within(window).findByLabelText("API Read Access Token"),
      { target: { value: "eyJ.token.sig" } },
    );
    fireEvent.click(within(window).getByRole("button", { name: "Save" }));

    // The tray offers the same lookup again for the files still left.
    await vi.waitFor(() =>
      expect(trayIcon()?.getAttribute("aria-label")).toBe(
        "12 files haven't been looked up on TMDB",
      ),
    );
    expect(within(window).getByRole("status").textContent).toBe(
      "Your TMDB key is saved.",
    );
  },
);

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
  await vi.waitFor(() => expect(trayIcon("TMDB isn't set up")).toBeNull());

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
  fireEvent.click(
    within(
      within(window).getByRole("dialog", { name: "Remove TMDB key" }),
    ).getByRole("button", { name: "Remove" }),
  );

  await vi.waitFor(() => expect(trayIcon("TMDB isn't set up")).toBeTruthy());
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
