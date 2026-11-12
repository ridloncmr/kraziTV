import { screen, within } from "@testing-library/react";

/**
 * The taskbar tray's one icon, found by the label it carries, or null while
 * none shows. The default matches every TMDB status the tray can wear, so a
 * test can read which one took the icon.
 */
export const trayIcon = (name: string | RegExp = /TMDB/) =>
  within(screen.getByRole("contentinfo")).queryByRole("button", { name });
