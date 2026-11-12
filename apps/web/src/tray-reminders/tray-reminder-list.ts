import type { MediaRoot } from "../http/contracts/media.js";
import type { TmdbKeyStatus } from "../http/contracts/metadata.js";
import { isScanRunning } from "../media-library/scan-progress/use-scan-job.js";
import type { TrayReminder, TrayStatusWords } from "./contracts.js";
import {
  lookupsRunningWords,
  TMDB_REMINDER_WORDS,
} from "./tray-reminder-words.js";

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

/**
 * The tray's status while lookups run: what every running job has looked
 * up of what it looks up, summed over the roots. A job that has not reached
 * its lookups yet, such as a scan still probing, counts nothing, so the
 * status waits for it; undefined when nothing is being looked up.
 */
export function lookupsRunning(
  mediaRoots: readonly MediaRoot[] | undefined,
): TrayStatusWords | undefined {
  let done = 0;
  let total = 0;
  for (const { scan } of mediaRoots ?? []) {
    if (scan === null || !isScanRunning(scan)) continue;
    done += scan.lookedUpCount;
    total += scan.lookupCount;
  }
  return total === 0 ? undefined : lookupsRunningWords(done, total);
}
