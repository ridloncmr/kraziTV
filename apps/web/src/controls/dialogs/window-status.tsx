import { createContext } from "react";

/**
 * The element in a program window's status bar that shows the program's
 * pending requests, lent to everything inside the window the way the dialog
 * layer is. Null outside a window, where feedback stays in place.
 */
export const WindowStatusSlot = createContext<HTMLElement | null>(null);
