import { expect, it } from "vitest";
import {
  GUIDE_WIDTH_PX,
  hourMarks,
  offsetPx,
  placeBlock,
} from "./guide-geometry.js";

const at = (time: string) => `2026-10-05T${time}:00.000Z`;
const windowStart = Date.parse(at("19:30"));

it("places a block at four pixels a minute, clipped to the window", () => {
  // Airing since before the window: starts at the left edge.
  expect(placeBlock(at("19:22"), at("19:45"), windowStart)).toEqual({
    left: 0,
    width: 60,
  });
  expect(placeBlock(at("20:00"), at("21:30"), windowStart)).toEqual({
    left: 120,
    width: 360,
  });
  // Runs past the window: ends at the right edge.
  expect(
    placeBlock(
      "2026-10-06T19:00:00.000Z",
      "2026-10-06T20:00:00.000Z",
      windowStart,
    ),
  ).toEqual({ left: GUIDE_WIDTH_PX - 120, width: 120 });
  // Over before the window, or starting after it: not shown.
  expect(placeBlock(at("19:00"), at("19:30"), windowStart)).toBeNull();
  expect(
    placeBlock(
      "2026-10-06T19:30:00.000Z",
      "2026-10-06T20:00:00.000Z",
      windowStart,
    ),
  ).toBeNull();
  expect(offsetPx(Date.parse(at("19:00")), windowStart)).toBe(-120);
});

it("marks every whole hour inside the window, an hour apart", () => {
  const marks = hourMarks(windowStart);
  expect(marks).toHaveLength(24);
  expect(marks[0].left).toBeGreaterThan(0);
  expect(marks[0].left).toBeLessThanOrEqual(240);
  expect(new Date(marks[0].instant).getMinutes()).toBe(0);
  for (let i = 1; i < marks.length; i++) {
    expect(marks[i].instant - marks[i - 1].instant).toBe(3_600_000);
  }
  expect(marks.at(-1)!.left).toBeLessThan(GUIDE_WIDTH_PX);
});
