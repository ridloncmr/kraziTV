import { createContext, useContext } from "react";

/**
 * Closes the window that holds a program at once, lent to everything inside
 * it the way the dialog layer is. A sheet calls it after OK saved, or after
 * the owner chose to discard; it never asks, so the caller asks first.
 */
export const CloseWindow = createContext<(() => void) | null>(null);

/** The close of the window this program sits in; a sheet outside a window is a wiring mistake, so it throws. */
export function useCloseWindow(): () => void {
  const close = useContext(CloseWindow);
  if (!close) throw new Error("A sheet must sit inside a window to close it.");
  return close;
}
