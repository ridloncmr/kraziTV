import { act } from "@testing-library/react";
import { vi } from "vitest";

/** One day in milliseconds, for tests that reason about snoozes and dates. */
export const DAY_MS = 24 * 60 * 60 * 1_000;

/** Advances fake time and lets React apply what the timers changed. */
export function elapse(ms: number) {
  return act(() => vi.advanceTimersByTimeAsync(ms));
}
