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
import { RefreshScope } from "../../http/resources/refresh-scope.js";
import { adminFixtures } from "../../testing/admin-fixtures.js";
import { BrowserApi } from "../../testing/browser-api.js";
import { guideStart } from "./guide-geometry.js";
import { GuideGrid } from "./guide-grid.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const at = (time: string) => `2026-10-05T${time}:00.000Z`;
// The window starts at 19:30's local half hour, wherever the test runs.
const windowStart = guideStart(Date.parse(at("19:30")));
const startsAt = new Date(windowStart).toISOString();
// Pixels from the window's start at four a minute, clipped at the left edge.
const px = (time: string) =>
  Math.max(0, ((Date.parse(at(time)) - windowStart) / 60_000) * 4);
// A program the server could word nothing about.
const BARE_PROGRAM = {
  title: "",
  subTitle: null,
  description: null,
  releaseDate: null,
  kind: null,
  genres: [],
  posterUrl: null,
  episode: null,
};
// The starts every schedule read asked for, in order.
const readStarts = (api: BrowserApi) =>
  api
    .requestsTo("/channels/one/schedule")
    .map((request) => request.query.get("start"));

// The channel rows alone; each row holds its own list of programs.
const channelRows = () => [
  ...screen
    .getByRole("list", { name: "Channels" })
    .querySelectorAll<HTMLElement>(":scope > li"),
];

// Northwoods TV at 19:30, mid-episode, with planned filler before a movie
// reserved at 20:00; the second channel has nothing in its window.
function guideApi() {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(at("19:30")));
  const api = new BrowserApi();
  api.reply("/channels", [
    adminFixtures.channels[0],
    { ...adminFixtures.channels[1], enabled: false },
  ]);
  api.reply("/channels/one/schedule", {
    scheduleRevision: 4,
    entries: [
      {
        id: "entry-1",
        title: "s01e02",
        startsAt: at("19:22"),
        endsAt: at("19:45"),
        program: {
          ...BARE_PROGRAM,
          title: "Northwoods Nights",
          subTitle: "Episode Two",
          description: "The second night is longer.",
          kind: "episode",
          genres: ["Drama"],
          posterUrl: "https://image.tmdb.org/t/p/w500/nights.jpg",
          episode: { season: 1, episode: 2, lastEpisode: 2 },
        },
      },
      {
        id: "entry-2",
        title: "Reserved Movie",
        startsAt: at("20:00"),
        endsAt: at("21:30"),
        program: { ...BARE_PROGRAM, title: "Reserved Movie" },
      },
    ],
    fillerIntervals: [
      { startsAt: at("19:45"), endsAt: at("20:00"), resumeTime: "8:00 PM" },
    ],
  });
  api.reply("/channels/two/schedule", {
    scheduleRevision: 1,
    entries: [],
    fillerIntervals: [],
  });
  vi.stubGlobal("fetch", api.fetch);
  return api;
}

it("lays each channel's programs and Off air along the window at their times, marking what airs", async () => {
  const api = guideApi();
  render(createElement(GuideGrid, { visible: true }));

  const programs = await screen.findByRole("list", {
    name: "Programs on Northwoods TV",
  });
  const blocks = within(programs).getAllByRole("listitem");
  expect(
    blocks.map((block) => block.querySelector("strong")?.textContent),
  ).toEqual(["Northwoods Nights", "Off air", "Reserved Movie"]);
  // An episode reads its own title, then its code with the time; media
  // without facts shows its time alone.
  const lines = (block: HTMLElement) =>
    [...block.querySelectorAll("span")].map((line) => line.textContent);
  expect(lines(blocks[0])[0]).toBe("Episode Two");
  expect(lines(blocks[0])[1]).toMatch(/^S01E02 · /);
  expect(lines(blocks[2])).toHaveLength(1);
  expect(lines(blocks[2])[0]).not.toContain("·");
  // Each block sits at its start, at four pixels a minute from the window.
  expect(blocks.map((block) => [block.style.left, block.style.width])).toEqual([
    [`${px("19:22")}px`, `${px("19:45") - px("19:22")}px`],
    [`${px("19:45")}px`, "60px"],
    [`${px("20:00")}px`, "360px"],
  ]);
  expect(blocks.map((block) => block.classList.contains("airing"))).toEqual([
    true,
    false,
    false,
  ]);
  expect(blocks[1].classList.contains("off-air")).toBe(true);
  // Each row asks for 24 hours from the top of the current half hour.
  expect(readStarts(api)).toEqual([startsAt]);
});

it("moves the window to the current half hour when its scope reloads, and not within it", async () => {
  const api = guideApi();
  const grid = (active: boolean) =>
    createElement(RefreshScope, {
      active,
      children: createElement(GuideGrid, { visible: true }),
    });
  const view = render(grid(true));
  await screen.findByRole("list", { name: "Programs on Northwoods TV" });

  // Refocused later in the same half hour: the same window, read again.
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(at("19:40")));
  view.rerender(grid(false));
  view.rerender(grid(true));
  await waitFor(() => expect(readStarts(api)).toEqual([startsAt, startsAt]));

  // Refocused the next day: the window is that day's current half hour.
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-06T09:10:00.000Z"));
  view.rerender(grid(false));
  view.rerender(grid(true));
  const later = new Date(
    guideStart(Date.parse("2026-10-06T09:10:00.000Z")),
  ).toISOString();
  await waitFor(() => expect(readStarts(api).at(-1)).toBe(later));
});

it("brings the window back to the current half hour from Now and when the clock turns", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const api = guideApi();
  render(createElement(GuideGrid, { visible: true }));
  await screen.findByRole("list", { name: "Programs on Northwoods TV" });

  // Scrolled nowhere, the guide follows the clock into the next half hour.
  const nextHour = Date.parse(at("19:30")) + 1_800_000;
  vi.spyOn(Date, "now").mockReturnValue(nextHour);
  await act(async () => {
    vi.advanceTimersByTime(60_000);
  });
  await waitFor(() =>
    expect(readStarts(api).at(-1)).toBe(
      new Date(guideStart(nextHour)).toISOString(),
    ),
  );

  // Now asks for the current half hour again, however far the clock has moved.
  const muchLater = nextHour + 5 * 3_600_000;
  vi.spyOn(Date, "now").mockReturnValue(muchLater);
  fireEvent.click(screen.getByRole("button", { name: "Now" }));
  await waitFor(() =>
    expect(readStarts(api).at(-1)).toBe(
      new Date(guideStart(muchLater)).toISOString(),
    ),
  );
});

it("opens a program's card from its block, with its poster, facts, and description", async () => {
  guideApi();
  render(createElement(GuideGrid, { visible: true }));
  const programs = await screen.findByRole("list", {
    name: "Programs on Northwoods TV",
  });

  fireEvent.click(
    within(programs).getByRole("button", { name: /Northwoods Nights/ }),
  );

  const card = screen.getByRole("dialog", { name: "Northwoods Nights" });
  expect(
    within(card)
      .getByRole("img", { name: "Poster for Northwoods Nights" })
      .getAttribute("src"),
  ).toBe("https://image.tmdb.org/t/p/w500/nights.jpg");
  expect(within(card).getByText("S01E02 · Episode Two")).toBeTruthy();
  expect(within(card).getByText(/on 69 Northwoods TV$/)).toBeTruthy();
  expect(within(card).getByText("Drama")).toBeTruthy();
  expect(within(card).getByText("The second night is longer.")).toBeTruthy();
  // TMDB's facts carry its logo and notice.
  expect(within(card).getByRole("img", { name: "TMDB" })).toBeTruthy();
  // Off air is a label, not a program.
  expect(
    within(programs).queryByRole("button", { name: /Off air/ }),
  ).toBeNull();
  fireEvent.click(within(card).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("names every channel, badges a disabled one, and says when a window is empty", async () => {
  guideApi();
  render(createElement(GuideGrid, { visible: true }));

  await screen.findByRole("list", { name: "Channels" });
  const rows = channelRows();
  expect(rows[0].textContent).toContain("69 Northwoods TV");
  expect(rows[1].textContent).toContain("70 Second channel");
  expect(within(rows[1]).getByText("Disabled")).toBeTruthy();
  await waitFor(() =>
    expect(within(rows[1]).getByText("Nothing scheduled")).toBeTruthy(),
  );
});

it("shows a row's failed read in that row and keeps the others", async () => {
  const api = guideApi();
  api.reply(
    "/channels/two/schedule",
    { error: { code: "offline", message: "Schedule unavailable" } },
    "GET",
    503,
  );
  render(createElement(GuideGrid, { visible: true }));

  await screen.findByRole("list", { name: "Programs on Northwoods TV" });
  const rows = channelRows();
  await within(rows[1]).findByText("Schedule unavailable");
  expect(within(rows[0]).queryByText("Schedule unavailable")).toBeNull();
});
