import { expect, it } from "vitest";
import {
  type StretchDraft,
  stretchProblem,
  toStretchDraft,
  UNCHOSEN_STRETCH,
} from "./stretch-fields.js";

const programs = (count: number): StretchDraft => ({
  ...UNCHOSEN_STRETCH,
  count,
});
const minutes = (minutes: number): StretchDraft =>
  toStretchDraft({ kind: "airtime", minutes });
const range = (minMinutes: number, maxMinutes: number): StretchDraft =>
  toStretchDraft({ kind: "airtime_range", minMinutes, maxMinutes });

it("finds a missing, zero, or fractional value incomplete, and a backwards range", () => {
  expect(stretchProblem(UNCHOSEN_STRETCH)).toBe("incomplete");
  expect(stretchProblem(programs(0))).toBe("incomplete");
  expect(stretchProblem(minutes(1.5))).toBe("incomplete");
  expect(stretchProblem(range(90, 60))).toBe("backwards");
  expect(stretchProblem(range(60, 60))).toBeNull();
  expect(stretchProblem(programs(3))).toBeNull();
});

it("holds a marathon that could run no longer than Plays at a time, as the server would", () => {
  expect(stretchProblem(programs(3), programs(3))).toBe("shorter");
  expect(stretchProblem(programs(2), programs(3))).toBe("shorter");
  expect(stretchProblem(programs(4), programs(3))).toBeNull();
  // A range's longest turn is what the marathon must beat.
  expect(stretchProblem(minutes(90), range(30, 90))).toBe("shorter");
  expect(stretchProblem(minutes(91), range(30, 90))).toBeNull();
  // A marathon range is judged by its shortest turn.
  expect(stretchProblem(range(60, 180), minutes(60))).toBe("shorter");
  expect(stretchProblem(range(61, 180), minutes(60))).toBeNull();
});

it("holds a marathon in another unit than Plays at a time", () => {
  expect(stretchProblem(minutes(600), programs(3))).toBe("unit");
  expect(stretchProblem(programs(9), minutes(60))).toBe("unit");
  expect(stretchProblem(range(120, 180), minutes(60))).toBeNull();
});

it("reports the marathon's own problem first, and skips the comparison while Plays at a time is unfinished", () => {
  expect(stretchProblem(programs(0), programs(3))).toBe("incomplete");
  expect(stretchProblem(range(90, 60), minutes(30))).toBe("backwards");
  expect(stretchProblem(programs(1), UNCHOSEN_STRETCH)).toBeNull();
});
