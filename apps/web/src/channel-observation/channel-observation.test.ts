// @vitest-environment jsdom
import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { adminFixtures } from "../testing/admin-fixtures.js";
import { BrowserApi } from "../testing/browser-api.js";
import { ChannelObservation } from "./channel-observation.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const at = (time: string) => `2026-10-05T${time}:00.000Z`;

// Northwoods TV during planned filler before a movie reserved at 20:00.
function guideApi() {
  const api = new BrowserApi();
  api.reply("/channels", adminFixtures.channels);
  api.reply("/channels/one/now", {
    evaluatedAt: at("19:50"),
    currentItem: {
      type: "filler",
      startsAt: at("19:45"),
      endsAt: at("20:00"),
      resumeTime: "8:00 PM",
      offsetMs: 300_000,
    },
    nextItem: {
      type: "program",
      title: "Reserved Movie",
      startsAt: at("20:00"),
      endsAt: at("21:30"),
    },
  });
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
  vi.stubGlobal("fetch", api.fetch);
  return api;
}

// Opens the guide and chooses Northwoods TV.
async function openGuide() {
  render(createElement(ChannelObservation, { visible: true, guide: true }));
  fireEvent.change(await screen.findByLabelText("Channel"), {
    target: { value: "one" },
  });
}

it("lists planned filler as an Off air row in time order among the programs", async () => {
  guideApi();

  await openGuide();

  const table = await screen.findByRole("table");
  const rows = within(table).getAllByRole("row").slice(1);
  // The day heads its rows once; the program rows carry only times.
  expect(within(table).getAllByRole("rowheader")).toHaveLength(1);
  expect(
    rows
      .filter((row) => !row.classList.contains("day-row"))
      .map((row) => within(row).getAllByRole("cell").at(2)?.textContent),
  ).toEqual(["Episode Two", "Off air", "Reserved Movie"]);
});

it("reports Off air with the resume time the server worded while filler airs", async () => {
  guideApi();

  await openGuide();

  expect(
    await screen.findByText("Off air — programming resumes at 8:00 PM"),
  ).toBeTruthy();
  expect(screen.getByText("Reserved Movie", { selector: "dd" })).toBeTruthy();
});
