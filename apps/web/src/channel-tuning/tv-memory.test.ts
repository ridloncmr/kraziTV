// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { readTvMemory, rememberTv } from "./tv-memory.js";

afterEach(() => localStorage.clear());

it("reads back the channel, volume, and mute it stored", () => {
  rememberTv({ channelId: "one", volume: 0.4, muted: true });
  expect(readTvMemory()).toEqual({
    channelId: "one",
    volume: 0.4,
    muted: true,
  });
});

it("starts at full volume with sound on when nothing or something unreadable is stored", () => {
  expect(readTvMemory()).toEqual({ volume: 1, muted: false });
  localStorage.setItem("krazitv.tv", "{not json");
  expect(readTvMemory()).toEqual({ volume: 1, muted: false });
  localStorage.setItem(
    "krazitv.tv",
    JSON.stringify({ channelId: 7, volume: 3, muted: "yes" }),
  );
  expect(readTvMemory()).toEqual({ volume: 1, muted: false });
});

it("keeps Live Monitor's channel when TV stores its own, and TV's when Live Monitor does", () => {
  rememberTv({ channelId: "one", volume: 0.4, muted: true });
  rememberTv({ monitorChannelId: "two" });
  rememberTv({ channelId: "three", volume: 0.5, muted: false });

  expect(readTvMemory()).toEqual({
    channelId: "three",
    monitorChannelId: "two",
    volume: 0.5,
    muted: false,
  });
});
