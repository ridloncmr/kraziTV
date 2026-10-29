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
