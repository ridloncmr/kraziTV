// @vitest-environment jsdom
import { createElement } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { adminFixtures } from "../testing/admin-fixtures.js";
import { BrowserApi } from "../testing/browser-api.js";
import { fakeBroadcasts } from "../testing/fake-broadcasts.js";
import { TvApp, type WatchRequest } from "./tv-app.js";

vi.mock("./broadcast-player.js", async () => {
  const { fakeBroadcasts } = await import("../testing/fake-broadcasts.js");
  return { startBroadcast: fakeBroadcasts.start };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fakeBroadcasts.reset();
  localStorage.clear();
});

const [northwoods, second] = adminFixtures.channels;

/** Serves a lineup of Northwoods TV, a disabled channel, and Second channel. */
function tvApi(): BrowserApi {
  const api = new BrowserApi();
  api.reply("/channels", [
    northwoods,
    { id: "resting", number: "69.1", name: "Resting TV", enabled: false },
    second,
  ]);
  api.reply("/channels/one/now", adminFixtures.now);
  api.reply("/channels/two/now", adminFixtures.now);
  vi.stubGlobal("fetch", api.fetch);
  return api;
}

/** Renders TV as the shell does, with `request` standing for the latest Watch. */
function renderTv(
  request?: WatchRequest,
  onOpenChannels: () => void = () => {},
) {
  return render(
    createElement(TvApp, { visible: true, request, onOpenChannels }),
  );
}

/** The channel each broadcast tuned, from its stream URL. */
const tunedPaths = () =>
  fakeBroadcasts.started.map((broadcast) => new URL(broadcast.url).pathname);

it("tunes the first enabled channel's stream and clears the screen once it plays", async () => {
  tvApi();
  renderTv();

  await screen.findByText("Alpha");
  expect(tunedPaths()).toEqual(["/channels/one/stream"]);
  expect(screen.getByText("Tuning…")).toBeTruthy();
  fireEvent.playing(screen.getByLabelText("69 Northwoods TV"));
  expect(screen.queryByText("Tuning…")).toBeNull();
});

it("steps up and down the lineup past disabled channels, ending the last channel's broadcast", async () => {
  tvApi();
  renderTv();
  await screen.findByText("Alpha");

  fireEvent.click(screen.getByRole("button", { name: "Channel up" }));
  expect(tunedPaths()).toEqual([
    "/channels/one/stream",
    "/channels/two/stream",
  ]);
  expect(fakeBroadcasts.started[0]?.stopped).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Channel up" }));
  expect(tunedPaths().at(-1)).toBe("/channels/one/stream");
  fireEvent.change(screen.getByRole("combobox", { name: "Channel" }), {
    target: { value: "two" },
  });
  expect(tunedPaths().at(-1)).toBe("/channels/two/stream");
});

it("tunes the channel each Watch asks for, even one already asked for before", async () => {
  tvApi();
  const view = renderTv({ channelId: "two", count: 1 });
  await screen.findByText("Alpha");
  expect(tunedPaths()).toEqual(["/channels/two/stream"]);

  fireEvent.click(screen.getByRole("button", { name: "Channel up" }));
  view.rerender(
    createElement(TvApp, {
      visible: true,
      request: { channelId: "two", count: 2 },
      onOpenChannels: () => {},
    }),
  );
  expect(tunedPaths().at(-1)).toBe("/channels/two/stream");
});

it("starts on the channel this browser last watched", async () => {
  localStorage.setItem(
    "krazitv.tv",
    JSON.stringify({ channelId: "two", volume: 0.5, muted: true }),
  );
  tvApi();
  renderTv();
  await screen.findByText("Alpha");

  expect(tunedPaths()).toEqual(["/channels/two/stream"]);
  const video = fakeBroadcasts.latest!.video;
  expect(video.volume).toBe(0.5);
  expect(video.muted).toBe(true);
});

it("remembers volume and mute, and a volume change turns the sound back on", async () => {
  tvApi();
  renderTv();
  await screen.findByText("Alpha");

  fireEvent.click(screen.getByRole("button", { name: "Mute" }));
  expect(fakeBroadcasts.latest!.video.muted).toBe(true);
  fireEvent.change(screen.getByRole("slider", { name: "Volume" }), {
    target: { value: "0.25" },
  });
  expect(fakeBroadcasts.latest!.video.muted).toBe(false);
  expect(JSON.parse(localStorage.getItem("krazitv.tv")!)).toEqual({
    channelId: "one",
    volume: 0.25,
    muted: false,
  });
});

it("says why there is no signal and tunes afresh on Try again", async () => {
  tvApi();
  renderTv();
  await screen.findByText("Alpha");

  act(() => fakeBroadcasts.latest!.fail({ kind: "refused", status: 409 }));
  expect(screen.getByRole("alert").textContent).toContain(
    "This channel has nothing on air, or was just disabled.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(tunedPaths()).toEqual([
    "/channels/one/stream",
    "/channels/one/stream",
  ]);
  expect(screen.getByText("Tuning…")).toBeTruthy();
});

it("keeps saying the broadcast stopped while the picture it buffered plays out", async () => {
  tvApi();
  renderTv();
  await screen.findByText("Alpha");

  act(() => fakeBroadcasts.latest!.fail({ kind: "ended" }));
  fireEvent.playing(screen.getByLabelText("69 Northwoods TV"));
  expect(screen.getByRole("alert").textContent).toContain(
    "The broadcast stopped.",
  );
});

it("keeps the reason when a play fails after the broadcast did, and offers a click only for blocked sound", async () => {
  tvApi();
  fakeBroadcasts.holdPlay = true;
  renderTv();
  await screen.findByText("Alpha");

  act(() => fakeBroadcasts.latest!.fail({ kind: "unplayable" }));
  await act(async () => fakeBroadcasts.latest!.rejectPlay("NotSupportedError"));
  expect(screen.getByRole("alert").textContent).toContain(
    "This browser can't play the broadcast.",
  );
  await act(async () => fakeBroadcasts.latest!.rejectPlay("NotAllowedError"));
  expect(screen.queryByRole("button", { name: "Turn on the TV" })).toBeNull();
});

it("keeps the channel on screen while a Watch for a channel newer than its list reads the list again", async () => {
  const api = tvApi();
  const view = renderTv({ channelId: "two", count: 1 });
  await screen.findByText("Alpha");
  api.reply("/channels", [
    northwoods,
    second,
    { id: "new", number: "71", name: "New TV", enabled: true },
  ]);
  api.reply("/channels/new/now", adminFixtures.now);
  view.rerender(
    createElement(TvApp, {
      visible: true,
      request: { channelId: "new", count: 2 },
      onOpenChannels: () => {},
    }),
  );

  await waitFor(() => expect(tunedPaths().at(-1)).toBe("/channels/new/stream"));
  expect(tunedPaths()).toEqual([
    "/channels/two/stream",
    "/channels/new/stream",
  ]);
});

it("keeps the remembered channel when TV closes before its list arrives", () => {
  localStorage.setItem(
    "krazitv.tv",
    JSON.stringify({ channelId: "two", volume: 1, muted: false }),
  );
  const api = new BrowserApi();
  api.hold("/channels");
  vi.stubGlobal("fetch", api.fetch);
  renderTv().unmount();

  expect(JSON.parse(localStorage.getItem("krazitv.tv")!).channelId).toBe("two");
});

it("offers a button when the browser wants a click before it plays sound", async () => {
  tvApi();
  fakeBroadcasts.refusePlay = true;
  renderTv();

  expect(
    await screen.findByRole("button", { name: "Turn on the TV" }),
  ).toBeTruthy();
});

it("points to My Channels when no channel can be watched", async () => {
  const api = new BrowserApi();
  api.reply("/channels", [{ ...northwoods, enabled: false }]);
  vi.stubGlobal("fetch", api.fetch);
  const onOpenChannels = vi.fn();
  renderTv(undefined, onOpenChannels);

  fireEvent.click(
    await screen.findByRole("button", { name: "Open My Channels" }),
  );
  expect(onOpenChannels).toHaveBeenCalled();
  expect(screen.getByText(/Every channel is disabled/)).toBeTruthy();
  expect(fakeBroadcasts.started).toEqual([]);
});

it("ends the broadcast when the window closes", async () => {
  tvApi();
  const view = renderTv();
  await screen.findByText("Alpha");

  view.unmount();
  expect(fakeBroadcasts.latest!.stopped).toBe(true);
});
