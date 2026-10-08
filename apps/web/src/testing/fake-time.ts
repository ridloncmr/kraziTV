import { act } from "@testing-library/react";
import { vi } from "vitest";

/** Advances fake time and lets React apply what the timers changed. */
export function elapse(ms: number) {
  return act(() => vi.advanceTimersByTimeAsync(ms));
}
