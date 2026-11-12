import { screen, within } from "@testing-library/react";

/**
 * The taskbar tray's one icon, found by the label it carries, or null while
 * none shows. The default matches every TMDB status the tray can wear, so a
 * test can read which one took the icon.
 */
export const trayIcon = (name: string | RegExp = /TMDB/) =>
  within(screen.getByRole("contentinfo")).queryByRole("button", { name });

/**
 * The open tray balloon, found by its title, or null while it is closed.
 * Without a title it finds whichever balloon is open, for a tray rendered
 * on its own with no window that could also be a dialog.
 */
export const trayBalloon = (name?: string | RegExp) =>
  screen.queryByRole("dialog", name === undefined ? {} : { name });

/**
 * One reminder's stored choice under its storage key, read as the next
 * desktop start would, or null while it has none.
 */
export const storedReminder = (storageKey: string) =>
  JSON.parse(localStorage.getItem(storageKey) ?? "null") as unknown;
