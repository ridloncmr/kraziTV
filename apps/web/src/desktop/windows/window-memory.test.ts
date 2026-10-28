// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import type { DesktopWindow } from "../contracts.js";
import { readWindowMemory, rememberWindows } from "./window-memory.js";

afterEach(() => localStorage.clear());

const channels: DesktopWindow = {
  id: "channels",
  openedOrder: 0,
  x: 200,
  y: 90,
  width: 800,
  height: 500,
  minimized: true,
  maximized: false,
};

it("remembers each window's placement, keeping a closed program's last one", () => {
  const first = rememberWindows({}, [
    channels,
    { ...channels, id: "media", x: 40, y: 20, maximized: true },
  ]);
  const later = rememberWindows(first, [{ ...channels, x: 300 }]);
  expect(readWindowMemory()).toEqual(later);
  expect(later).toEqual({
    channels: { x: 300, y: 90, width: 800, height: 500, maximized: false },
    media: { x: 40, y: 20, width: 800, height: 500, maximized: true },
  });
});

it("ignores stored entries that are not placements, so an edited value never opens a window off screen", () => {
  localStorage.setItem(
    "krazitv.windows",
    JSON.stringify({
      channels: { x: "far", y: 1, width: 2, height: 3, maximized: false },
      media: { x: 1, y: 2, width: 3, height: 4, maximized: true },
    }),
  );
  expect(readWindowMemory()).toEqual({
    media: { x: 1, y: 2, width: 3, height: 4, maximized: true },
  });
  localStorage.setItem("krazitv.windows", "not json");
  expect(readWindowMemory()).toEqual({});
});

it("keeps one placement for each properties kind, from the front window", () => {
  const properties = (channelId: string, x: number): DesktopWindow => ({
    ...channels,
    id: `channel-properties:${channelId}`,
    x,
  });
  expect(
    rememberWindows({}, [properties("one", 100), properties("two", 400)]),
  ).toEqual({
    "channel-properties": {
      x: 400,
      y: 90,
      width: 800,
      height: 500,
      maximized: false,
    },
  });
});
