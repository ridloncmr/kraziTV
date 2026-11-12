import type { MediaRoot } from "../http/contracts/media.js";
import type { TmdbKeyStatus } from "../http/contracts/metadata.js";
import type { TrayReminder } from "./contracts.js";
import { TMDB_REMINDER_WORDS } from "./tray-reminder-words.js";

/**
 * The tray reminders in the spec's order (spec 0006, Tray reminders),
 * evaluated from what the shell has read; a read that has not answered yet
 * holds nothing, so no balloon opens on a guess. The TMDB reminder keeps
 * its original storage key, so a choice made before the tray grew reminders
 * still counts. Its icon shows whenever no key is set, as spec 0001 has it,
 * so the setting is never lost; its balloon opens by itself only once there
 * is media to look up.
 */
export function trayReminders({
  tmdbKey,
  mediaRoots,
  setUpTmdb,
}: {
  tmdbKey: TmdbKeyStatus | undefined;
  mediaRoots: readonly MediaRoot[] | undefined;
  /** Opens Account Settings on the Set up TMDB task. */
  setUpTmdb: () => void;
}): TrayReminder[] {
  const noKey = tmdbKey?.configured === false;
  return [
    {
      storageKey: "krazitv.tmdbReminder",
      words: TMDB_REMINDER_WORDS,
      shows: noKey,
      holds: noKey && (mediaRoots?.length ?? 0) > 0,
      act: setUpTmdb,
    },
  ];
}
