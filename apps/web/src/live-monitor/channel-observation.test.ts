// @vitest-environment jsdom
import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { UNREACHABLE_SENTENCE } from "../http/api-client.js";
import { adminFixtures } from "../testing/admin-fixtures.js";
import { BrowserApi } from "../testing/browser-api.js";
import { rememberTv } from "../channel-tuning/tv-memory.js";
import { ChannelObservation } from "./channel-observation.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const at = (time: string) => `2026-10-05T${time}:00.000Z`;

// Northwoods TV during planned filler before a movie reserved at 20:00.
function monitorApi() {
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

// Opens the monitor and chooses Northwoods TV.
async function openMonitor() {
  render(
    createElement(ChannelObservation, { visible: true, openProgram: () => {} }),
  );
  fireEvent.change(await screen.findByLabelText("Channel"), {
    target: { value: "one" },
  });
}

it("reports Off air with the resume time the server worded while filler airs", async () => {
  monitorApi();

  await openMonitor();

  expect(
    await screen.findByText("Off air — programming resumes at 8:00 PM"),
  ).toBeTruthy();
  expect(screen.getByText("Reserved Movie", { selector: "dd" })).toBeTruthy();
});

it("says in plain words why nothing is on air, never the server's reason code", async () => {
  const api = monitorApi();
  api.reply("/channels/one/now", {
    evaluatedAt: at("19:50"),
    currentItem: null,
    nextItem: null,
    reason: "schedule_gap",
  });

  await openMonitor();

  expect(
    await screen.findByText(
      "Nothing is scheduled right now. Check that the channel's shows have media that can air (not missing or too short), and its Lineup and Rules tabs.",
    ),
  ).toBeTruthy();
  expect(screen.queryByText(/schedule.gap/)).toBeNull();
});

it("opens My Channels from the empty state when there are no channels", async () => {
  const api = new BrowserApi();
  api.reply("/channels", []);
  vi.stubGlobal("fetch", api.fetch);
  const openProgram = vi.fn();
  render(createElement(ChannelObservation, { visible: true, openProgram }));

  fireEvent.click(
    await screen.findByRole("button", { name: "Open My Channels" }),
  );

  expect(openProgram).toHaveBeenCalledWith("channels");
  expect(screen.getByText(/No channels yet/).className).toBe("empty-state");
});

it("shows no channel list until the list arrives", async () => {
  const api = monitorApi();
  api.hold("/channels");
  render(
    createElement(ChannelObservation, { visible: true, openProgram: () => {} }),
  );

  expect(await screen.findByText("Working… Please wait.")).toBeTruthy();
  expect(screen.queryByLabelText("Channel")).toBeNull();
  expect(screen.queryByText(/Choose a channel/)).toBeNull();

  api.release("/channels", adminFixtures.channels);
  expect(await screen.findByLabelText("Channel")).toBeTruthy();
});

it("shows the problem and Refresh, with no channel list, when the channel list cannot be read", async () => {
  const api = monitorApi();
  api.handle("/channels", () => {
    throw new TypeError("Failed to fetch");
  });
  render(
    createElement(ChannelObservation, { visible: true, openProgram: () => {} }),
  );

  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    UNREACHABLE_SENTENCE,
  );
  expect(screen.queryByLabelText("Channel")).toBeNull();
  expect(screen.queryByText(/Choose a channel/)).toBeNull();

  api.reply("/channels", adminFixtures.channels);
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

  expect(await screen.findByLabelText("Channel")).toBeTruthy();
  expect(
    await screen.findByText("Off air — programming resumes at 8:00 PM"),
  ).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("opens on the first enabled channel, then on the channel chosen when it last closed", async () => {
  const api = monitorApi();
  api.reply("/channels", [
    { id: "resting", number: "68", name: "Resting TV", enabled: false },
    ...adminFixtures.channels,
  ]);
  api.reply("/channels/two/now", adminFixtures.now);
  const open = () =>
    render(
      createElement(ChannelObservation, {
        visible: true,
        openProgram: () => {},
      }),
    );

  const first = open();
  expect(
    await screen.findByText("Off air — programming resumes at 8:00 PM"),
  ).toBeTruthy();
  expect(screen.queryByText("Choose a channel")).toBeNull();
  fireEvent.change(screen.getByLabelText("Channel"), {
    target: { value: "two" },
  });
  first.unmount();
  open();

  await waitFor(() =>
    expect(screen.getByLabelText<HTMLSelectElement>("Channel").value).toBe(
      "two",
    ),
  );
  expect(await screen.findByText("Alpha")).toBeTruthy();
});

it("reopens on a remembered channel even when it is disabled, since the monitor shows a disabled channel's state", async () => {
  const api = monitorApi();
  api.reply("/channels", [
    { id: "resting", number: "68", name: "Resting TV", enabled: false },
    ...adminFixtures.channels,
  ]);
  api.reply("/channels/resting/now", adminFixtures.now);
  rememberTv({ monitorChannelId: "resting" });

  render(
    createElement(ChannelObservation, { visible: true, openProgram: () => {} }),
  );

  await waitFor(() =>
    expect(screen.getByLabelText<HTMLSelectElement>("Channel").value).toBe(
      "resting",
    ),
  );
});
