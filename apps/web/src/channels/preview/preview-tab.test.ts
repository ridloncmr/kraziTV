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
  adminFixtures,
  favoritesAssignment,
} from "../../testing/admin-fixtures.js";
import { BrowserApi } from "../../testing/browser-api.js";
import { openChannelTab } from "../../testing/channel-tabs.js";
import { ChannelWindows } from "../../testing/channel-windows.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("lists upcoming turns in owner words: the show, what plays, already airing, overrun, marathons, and skips", async () => {
  const api = new BrowserApi();
  api.reply("/channels/one/programming-assignments", [
    favoritesAssignment("chronological", { name: "Evening Favorites" }),
  ]);
  api.reply("/media-collections", adminFixtures.collections);
  api.reply("/programming-assignments/stretch-suggestion", {
    ordinaryStretch: { kind: "programs", count: 3 },
    contentKind: "episodes",
  });
  const program = (title: string) => ({
    mediaItemId: title,
    title,
    startsAt: "2026-10-14T20:00:00.000Z",
    endsAt: "2026-10-14T20:22:00.000Z",
  });
  const turn = {
    assignmentId: "assignment",
    member: {
      kind: "collection",
      mediaCollectionId: "favorites",
      playbackMode: "chronological",
    },
    roundNumber: 2,
    turnIndex: 0,
    continues: false,
    winningRuleId: null,
    skippedRules: [],
    decidedAt: "2026-10-14T20:00:00.000Z",
    settingOrigins: { ordinary: "assignment", marathon: "assignment" },
    startsAt: "2026-10-14T20:00:00.000Z",
    endsAt: "2026-10-14T21:06:00.000Z",
    size: { kind: "airtime", value: 60 },
    marathon: false,
    marathonChancePercent: null,
    airtimeMinutes: 66,
    overrunMinutes: 6,
    programs: [program("One"), program("Two"), program("Three")],
  };
  api.reply("/channels/one/programming-preview", {
    configurationRevision: 3,
    turns: [
      {
        ...turn,
        continues: true,
        overrunMinutes: null,
        airtimeMinutes: 22,
        programs: [program("One")],
      },
      turn,
      {
        ...turn,
        size: { kind: "programs", value: 6 },
        marathon: true,
        marathonChancePercent: 10,
        overrunMinutes: null,
      },
    ],
    skips: [
      {
        assignmentId: "assignment",
        roundNumber: 2,
        reasons: ["empty_collection"],
      },
    ],
  });
  vi.stubGlobal("fetch", api.fetch);
  await openChannelTab(api, "Preview");

  const turns = await screen.findByRole("list", { name: "Upcoming shows" });
  // The owner's name for the show, and its episodes once the suggestion
  // has named the content kind.
  await waitFor(() =>
    expect(within(turns).getAllByRole("listitem")[0]?.textContent).toMatch(
      /Evening Favorites · 1 episode \(22 min\) · already airing$/,
    ),
  );
  const lines = within(turns)
    .getAllByRole("listitem")
    .map((item) => item.textContent);
  expect(lines[1]).toMatch(
    /3 episodes \(1 hr 6 min\) · 6 min over its 1 hr target, since whole programs air$/,
  );
  expect(lines[2]).toMatch(
    /Evening Favorites · marathon, 3 episodes \(1 hr 6 min\)$/,
  );
  expect(screen.getByRole("list", { name: "Skipped shows" }).textContent).toBe(
    "Evening Favorites is skipped: its collection is empty.",
  );
  const preview = screen.getByRole("region", { name: "Upcoming programming" });
  expect(preview.textContent).not.toMatch(/assignment|round|%|rotation/i);
});

it("lets the airing program finish by default when rebuilding", async () => {
  const api = new BrowserApi();
  api.reply("/channels/one/programming-assignments", [
    favoritesAssignment("chronological"),
  ]);
  api.reply("/media-collections", adminFixtures.collections);
  api.reply("/channels/one/schedule/generate", {}, "POST");
  vi.stubGlobal("fetch", api.fetch);
  await openChannelTab(api, "Preview");

  fireEvent.click(
    await screen.findByRole("button", { name: "Rebuild the schedule…" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Rebuild the schedule" });
  expect(
    within(dialog).getByRole<HTMLInputElement>("radio", {
      name: "Let it finish",
    }).checked,
  ).toBe(true);
  fireEvent.click(within(dialog).getByRole("button", { name: "Rebuild" }));

  await within(dialog).findByText(/rebuilt after what is airing now/);
  expect(
    api.requests.find((request) => request.method === "POST")?.body,
  ).toEqual({ regenerate: true });
  expect(api.requestsTo("/channels/one/programming/rebuild")).toEqual([]);
});

it("stops the airing program on request, disclosing the disconnect, and keeps a failed cleanup for retry with the same key after the window closes", async () => {
  const api = new BrowserApi();
  api.reply("/channels", [adminFixtures.channels[0]]);
  api.reply("/channels/one/programming-assignments", [
    favoritesAssignment("chronological"),
  ]);
  api.reply("/media-collections", adminFixtures.collections);
  api.reply(
    "/channels/one/programming/rebuild",
    { rebuilt: true, stopFailed: true },
    "POST",
  );
  vi.stubGlobal("fetch", api.fetch);
  const editor = await openChannelTab(api, "Preview");
  fireEvent.click(
    await screen.findByRole("button", { name: "Rebuild the schedule…" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Rebuild the schedule" });

  fireEvent.click(
    within(dialog).getByRole("radio", {
      name: "Stop it now and rebuild the schedule",
    }),
  );
  expect(dialog.textContent).toMatch(/disconnected and must tune in again/);
  fireEvent.click(within(dialog).getByRole("button", { name: "Rebuild" }));
  await within(dialog).findByText(/could not be stopped/);
  editor.unmount();

  // The retry outlives the closed window and repeats the rebuild's key.
  render(createElement(ChannelWindows));
  await screen.findByText("Schedule rebuilt with fresh programming.");
  api.reply(
    "/channels/one/programming/rebuild",
    { rebuilt: false, stopFailed: false },
    "POST",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Retry runtime cleanup" }),
  );

  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Retry runtime cleanup" }),
    ).toBeNull(),
  );
  const keys = api
    .requestsTo("/channels/one/programming/rebuild")
    .map(
      (request) => (request.body as { idempotencyKey: string }).idempotencyKey,
    );
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
});

it("explains which rule chose each turn, the rules it passed over, and where its settings came from", async () => {
  const api = new BrowserApi();
  api.reply("/channels/one/programming-assignments", [
    favoritesAssignment("chronological"),
  ]);
  api.reply("/media-collections", adminFixtures.collections);
  const rule = (id: string, name: string) => ({
    id,
    name,
    behavior: "feature",
    priority: 1,
    dates: { kind: "any" },
    weekdays: null,
    window: { startMinute: 18 * 60, endMinute: 23 * 60 },
    sources: [],
  });
  api.reply("/channels/one/programming-rules", [
    rule("fridays", "Friday movies"),
    rule("broken", "Nothing to air"),
  ]);
  const turn = {
    assignmentId: "assignment",
    member: {
      kind: "collection",
      mediaCollectionId: "favorites",
      playbackMode: "chronological",
    },
    roundNumber: 1,
    turnIndex: 0,
    continues: false,
    winningRuleId: "fridays",
    skippedRules: [{ ruleId: "broken", reason: "no_usable_source" }],
    decidedAt: "2026-10-16T22:00:00.000Z",
    settingOrigins: { ordinary: "rule", marathon: "disabled" },
    startsAt: "2026-10-16T22:00:00.000Z",
    endsAt: "2026-10-16T23:30:00.000Z",
    size: { kind: "programs", value: 2 },
    marathon: false,
    marathonChancePercent: null,
    airtimeMinutes: 90,
    overrunMinutes: null,
    programs: [
      {
        mediaItemId: "a",
        title: "A",
        startsAt: "2026-10-16T22:00:00.000Z",
        endsAt: "2026-10-16T23:30:00.000Z",
      },
    ],
  };
  api.reply("/channels/one/programming-preview", {
    configurationRevision: 4,
    turns: [
      turn,
      {
        ...turn,
        winningRuleId: null,
        skippedRules: [],
        settingOrigins: { ordinary: "assignment", marathon: "assignment" },
      },
    ],
    skips: [],
  });
  vi.stubGlobal("fetch", api.fetch);
  await openChannelTab(api, "Preview");

  const turns = await screen.findByRole("list", { name: "Upcoming shows" });
  await waitFor(() =>
    expect(within(turns).getAllByRole("listitem")[0]?.textContent).toMatch(
      /chosen by Friday movies/,
    ),
  );
  const [ruled, defaulted] = within(turns)
    .getAllByRole("listitem")
    .map((item) => item.textContent);
  expect(ruled).toMatch(
    /passed over Nothing to air: none of its shows can air/,
  );
  expect(ruled).toMatch(/length set by the rule · no marathons under the rule/);
  // A default turn says so only because a rule is in play beside it.
  expect(defaulted).toMatch(
    /Favorites · 1 program \(1 hr 30 min\) · normal rotation$/,
  );
  expect(screen.getByText(/checked at program boundaries/).textContent).toMatch(
    /never promises a program starts exactly when a window opens/,
  );
});
