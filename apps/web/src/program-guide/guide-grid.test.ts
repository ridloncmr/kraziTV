// @vitest-environment jsdom
import { createElement } from "react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { adminFixtures } from "../testing/admin-fixtures.js";
import { BrowserApi } from "../testing/browser-api.js";
import { GuideGrid } from "./guide-grid.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const at = (time: string) => `2026-10-05T${time}:00.000Z`;

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
        title: "Episode Two",
        startsAt: at("19:22"),
        endsAt: at("19:45"),
      },
      {
        id: "entry-2",
        title: "Reserved Movie",
        startsAt: at("20:00"),
        endsAt: at("21:30"),
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
  ).toEqual(["Episode Two", "Off air", "Reserved Movie"]);
  // Airing since 19:22: clipped to the left edge, 15 minutes to go at 4px each.
  expect(blocks.map((block) => [block.style.left, block.style.width])).toEqual([
    ["0px", "60px"],
    ["60px", "60px"],
    ["120px", "360px"],
  ]);
  expect(blocks.map((block) => block.classList.contains("airing"))).toEqual([
    true,
    false,
    false,
  ]);
  expect(blocks[1].classList.contains("off-air")).toBe(true);
  // Each row asks for 24 hours from the anchor.
  expect(api.requestsTo("/channels/one/schedule")[0]?.query.get("start")).toBe(
    at("19:30"),
  );
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
