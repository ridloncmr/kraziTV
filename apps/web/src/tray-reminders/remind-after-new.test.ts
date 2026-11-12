// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderDesktopShell } from "../testing/auth-fixtures.js";
import { BrowserApi } from "../testing/browser-api.js";
import {
  decidedRecommendations,
  severalRecommendations,
} from "../testing/collection-api.js";
import { DAY_MS, elapse } from "../testing/fake-time.js";
import { pressEnter } from "../testing/press-enter.js";
import { regainFocus } from "../testing/regain-focus.js";
import { idleRoot } from "../testing/scan-fixtures.js";
import { bootTray, SETTLED_LIBRARY } from "../testing/tray-boot.js";
import {
  storedReminder,
  storeReminder,
  trayBalloon,
  trayIcon,
} from "../testing/tray-queries.js";

// Collections ready's fourth answer, **Remind me after** a number of new
// ones (spec 0006, decision 24 as amended on 2026-11-12).

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

const STORAGE_KEY = "krazitv.collectionsReadyReminder";
const RECOMMENDATIONS = "/media-collections/recommendations";
const REFUSAL = "Enter a whole number from 1 to 99.";

/** Stores a choice as if the owner had answered at an earlier start. */
const answered = (state: unknown) => storeReminder(STORAGE_KEY, state);

/** The open Collections ready balloon, with its field and button. */
async function collectionsBalloon() {
  const balloon = await screen.findByRole("dialog", { name: /kraziTV found/ });
  return {
    balloon,
    field: within(balloon).getByRole<HTMLInputElement>("spinbutton", {
      name: "New ones to wait for",
    }),
    button: within(balloon).getByRole("button", { name: "Remind me after" }),
  };
}

it("offers Remind me after 5 new ones without taking focus, and stores the number chosen with the count still to decide", async () => {
  const focused = document.activeElement;
  await bootTray({
    ...SETTLED_LIBRARY,
    recommendations: severalRecommendations("series", 17),
  });
  const { balloon, field, button } = await collectionsBalloon();
  expect(field.value).toBe("5");
  expect(within(balloon).getByText("new ones")).toBeTruthy();
  expect(document.activeElement).toBe(focused);

  fireEvent.change(field, { target: { value: "3" } });
  fireEvent.click(button);

  expect(trayBalloon(/kraziTV found/)).toBeNull();
  expect(storedReminder(STORAGE_KEY)).toEqual({ afterNew: 3, lowestSeen: 17 });
  expect(localStorage.getItem("krazitv.tmdbReminder")).toBeNull();
  expect(localStorage.getItem("krazitv.notLookedUpReminder")).toBeNull();
});

it("chooses it with Enter in the field", async () => {
  await bootTray({
    ...SETTLED_LIBRARY,
    recommendations: severalRecommendations("series", 17),
  });
  const { field } = await collectionsBalloon();
  fireEvent.change(field, { target: { value: "12" } });

  pressEnter(field);

  expect(trayBalloon(/kraziTV found/)).toBeNull();
  expect(storedReminder(STORAGE_KEY)).toEqual({ afterNew: 12, lowestSeen: 17 });
});

it.each([["0"], ["100"], ["2.5"], [""]])(
  "refuses %j, storing nothing and keeping the balloon open",
  async (value) => {
    await bootTray({
      ...SETTLED_LIBRARY,
      recommendations: severalRecommendations("series", 17),
    });
    const { balloon, field, button } = await collectionsBalloon();
    fireEvent.change(field, { target: { value } });

    fireEvent.click(button);

    expect(within(balloon).getByRole("alert").textContent).toBe(REFUSAL);
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(trayBalloon(/kraziTV found/)).toBe(balloon);
    expect(storedReminder(STORAGE_KEY)).toBeNull();

    // Enter refuses the same way.
    pressEnter(field);
    expect(trayBalloon(/kraziTV found/)).toBe(balloon);
    expect(storedReminder(STORAGE_KEY)).toBeNull();
  },
);

it("closes with Escape in the field as ✕ does, storing a snooze rather than the number", async () => {
  await bootTray({
    ...SETTLED_LIBRARY,
    recommendations: severalRecommendations("series", 17),
  });
  const { field } = await collectionsBalloon();
  fireEvent.change(field, { target: { value: "8" } });

  fireEvent.keyDown(field, { key: "Escape" });

  expect(trayBalloon(/kraziTV found/)).toBeNull();
  expect(storedReminder(STORAGE_KEY)).toEqual({
    remindAfter: expect.any(Number),
    answeredCount: 17,
  });
});

it.each([
  ["one below the fewest seen plus the number", 16, false],
  ["the fewest seen plus the number", 17, true],
])(
  "with %s waiting, opens by itself only at that count, with no 7-day wait",
  async (_, waiting, opens) => {
    // Answered moments ago: a 7-day snooze would still hold it back.
    answered({ afterNew: 5, lowestSeen: 12 });
    const api = await bootTray({
      ...SETTLED_LIBRARY,
      recommendations: severalRecommendations("series", waiting),
    });
    await vi.waitFor(() =>
      expect(api.requestsTo(RECOMMENDATIONS)).not.toHaveLength(0),
    );

    // The icon shows either way, so the owner can still open it.
    await screen.findByRole("button", {
      name: `kraziTV found ${waiting} shows`,
    });
    expect(trayBalloon(/kraziTV found/) !== null).toBe(opens);
  },
);

it("counts new ones from the fewest seen, so deciding the ones it showed never holds it back", async () => {
  const api = await bootTray({
    ...SETTLED_LIBRARY,
    recommendations: severalRecommendations("series", 17),
  });
  const { button } = await collectionsBalloon();
  fireEvent.click(button);
  expect(storedReminder(STORAGE_KEY)).toEqual({ afterNew: 5, lowestSeen: 17 });

  // The owner makes collections out of 10, then out of the rest.
  api.reply(RECOMMENDATIONS, [
    ...decidedRecommendations(10),
    ...severalRecommendations("series", 7, 11),
  ]);
  regainFocus();
  await vi.waitFor(() =>
    expect(storedReminder(STORAGE_KEY)).toEqual({
      afterNew: 5,
      lowestSeen: 7,
    }),
  );
  api.reply(RECOMMENDATIONS, decidedRecommendations(17));
  regainFocus();
  await vi.waitFor(() =>
    expect(storedReminder(STORAGE_KEY)).toEqual({
      afterNew: 5,
      lowestSeen: 0,
    }),
  );
  expect(trayIcon(/^kraziTV found/)).toBeNull();

  // A later start with 4 new ones waiting stays quiet; one with 5 opens.
  cleanup();
  await bootTray({
    ...SETTLED_LIBRARY,
    recommendations: [
      ...decidedRecommendations(17),
      ...severalRecommendations("series", 4, 100),
    ],
  });
  await screen.findByRole("button", { name: "kraziTV found 4 shows" });
  expect(trayBalloon(/kraziTV found/)).toBeNull();
  // More waiting never raises the fewest seen.
  expect(storedReminder(STORAGE_KEY)).toEqual({ afterNew: 5, lowestSeen: 0 });

  cleanup();
  await bootTray({
    ...SETTLED_LIBRARY,
    recommendations: [
      ...decidedRecommendations(17),
      ...severalRecommendations("series", 5, 100),
    ],
  });
  expect(
    await screen.findByRole("dialog", { name: "kraziTV found 5 shows" }),
  ).toBeTruthy();
});

it("never lowers the fewest seen while files are left to look up or the settle's read is out", async () => {
  answered({ afterNew: 5, lowestSeen: 17 });
  vi.useFakeTimers();
  const api = new BrowserApi();
  api.reply("/health", { status: "ok" });
  api.reply("/metadata/tmdb-key", { configured: true });
  api.reply("/media-roots", [idleRoot("a", 3)]);
  api.reply(RECOMMENDATIONS, severalRecommendations("series", 2));
  renderDesktopShell(api);
  await elapse(0);
  expect(api.requestsTo(RECOMMENDATIONS)).toHaveLength(0);
  expect(storedReminder(STORAGE_KEY)).toEqual({ afterNew: 5, lowestSeen: 17 });

  // Settled, but the read made for it has not answered.
  api.reply("/media-roots", [idleRoot("a")]);
  api.hold(RECOMMENDATIONS);
  regainFocus();
  await elapse(0);
  expect(api.requestsTo(RECOMMENDATIONS)).toHaveLength(1);
  expect(storedReminder(STORAGE_KEY)).toEqual({ afterNew: 5, lowestSeen: 17 });

  // Its answer of 22 is 5 more than the fewest seen.
  api.release(RECOMMENDATIONS, severalRecommendations("series", 22));
  await elapse(0);
  expect(
    screen.getByRole("dialog", { name: "kraziTV found 22 shows" }),
  ).toBeTruthy();
  expect(storedReminder(STORAGE_KEY)).toEqual({ afterNew: 5, lowestSeen: 17 });
});

it("offers no Remind me after on a reminder that counts nothing, and leaves another reminder's answer alone", async () => {
  answered({ afterNew: 5, lowestSeen: 0 });
  await bootTray({ configured: false, roots: [idleRoot("a")] });

  const balloon = await screen.findByRole("dialog", {
    name: "TMDB isn't set up",
  });
  expect(
    within(balloon).queryByRole("button", { name: "Remind me after" }),
  ).toBeNull();
  expect(within(balloon).queryByRole("spinbutton")).toBeNull();
  fireEvent.click(
    within(balloon).getByRole("button", { name: "Don't remind me" }),
  );
  expect(storedReminder(STORAGE_KEY)).toEqual({ afterNew: 5, lowestSeen: 0 });
  expect(storedReminder("krazitv.tmdbReminder")).toEqual({ never: true });
});

it("replaces Remind me after with the 7-day snooze another answer always stored", async () => {
  answered({ afterNew: 1, lowestSeen: 1 });
  const before = Date.now();
  await bootTray({
    ...SETTLED_LIBRARY,
    recommendations: severalRecommendations("series", 2),
  });
  const { balloon } = await collectionsBalloon();

  // Another answer replaces it with the snooze decision 24 has always stored.
  fireEvent.click(
    within(balloon).getByRole("button", { name: "Remind me later" }),
  );
  const stored = storedReminder(STORAGE_KEY) as {
    remindAfter: number;
    answeredCount: number;
  };
  expect(stored).toEqual({ remindAfter: expect.any(Number), answeredCount: 2 });
  expect(stored.remindAfter - before).toBeGreaterThanOrEqual(7 * DAY_MS);
});
