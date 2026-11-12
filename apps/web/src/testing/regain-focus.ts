import { act } from "@testing-library/react";

/**
 * Reloads the page's reads, as the browser window regaining focus does.
 * Blur and focus go in separate acts, so React sees the window lose focus
 * before it returns; batched together they would cancel out.
 */
export function regainFocus() {
  act(() => {
    globalThis.dispatchEvent(new Event("blur"));
  });
  act(() => {
    globalThis.dispatchEvent(new Event("focus"));
  });
}
