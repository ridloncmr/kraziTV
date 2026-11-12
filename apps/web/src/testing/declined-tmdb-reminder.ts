import type { Page } from "@playwright/test";

/**
 * Starts the page's browser as an owner who already answered the TMDB
 * reminder with **Don't remind me**, in the stored shape
 * `tray-reminders/reminder-state.ts` reads. The test servers set no TMDB
 * key, so once a scenario has a media root the balloon opens by itself over
 * the bottom-right of the screen, whenever the shell's reads say so; a
 * scenario that is not about reminders calls this before `page.goto`, so the
 * balloon never covers what it clicks, however the reads are timed.
 */
export async function declineTmdbReminder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      "krazitv.tmdbReminder",
      JSON.stringify({ never: true }),
    );
  });
}
