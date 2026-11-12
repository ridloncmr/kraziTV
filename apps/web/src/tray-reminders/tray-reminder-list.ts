import type { Recommendation } from "../http/contracts/collections.js";
import type { MediaRoot } from "../http/contracts/media.js";
import type { TmdbKeyStatus } from "../http/contracts/metadata.js";
import { anyRootJobRunning, isScanRunning } from "../scan-jobs/scan-running.js";
import type { TrayReminder, TrayStatusWords } from "./contracts.js";
import {
  collectionsReadyWords,
  filesNotLookedUpWords,
  lookupsRunningWords,
  TMDB_REMINDER_WORDS,
} from "./tray-reminder-words.js";

/**
 * How many files are left to look up once the library has settled: a key
 * is set, no scan or lookup runs, and every root's never-looked-up files
 * that a lookup would search for are summed over the enabled roots. Failed
 * lookups are left out, so a rejected key or a TMDB outage does not nag.
 * Undefined while unsettled or while a read has not answered, so reminders
 * 2 and 3 never act on a guess; the shell reads recommendations only while
 * this is 0.
 */
export function filesLeftToLookUp(
  tmdbKey: TmdbKeyStatus | undefined,
  mediaRoots: readonly MediaRoot[] | undefined,
): number | undefined {
  if (tmdbKey?.configured !== true || mediaRoots === undefined) return;
  if (anyRootJobRunning(mediaRoots)) return;
  return mediaRoots
    .filter((root) => root.enabled)
    .reduce((sum, root) => sum + root.matchCounts.notLookedUp, 0);
}

/**
 * The tray reminders in the spec's order (spec 0006, Tray reminders),
 * evaluated from what the shell has read; a read that has not answered yet
 * holds nothing, so no balloon opens on a guess. The TMDB reminder keeps
 * its original storage key, so a choice made before the tray grew reminders
 * still counts. Its icon shows whenever no key is set, as spec 0001 has it,
 * so the setting is never lost; its balloon opens by itself only once there
 * is media to look up. Files not looked up and Collections ready show
 * exactly while they hold. Collections ready counts only recommendations
 * still to decide, not ones already saved as manual collections, and is
 * due again only when there are more of them than the owner last answered.
 */
export function trayReminders({
  tmdbKey,
  mediaRoots,
  recommendations,
  setUpTmdb,
  lookUpFiles,
  makeCollections,
}: {
  tmdbKey: TmdbKeyStatus | undefined;
  mediaRoots: readonly MediaRoot[] | undefined;
  /**
   * The shell's read, made only while nothing is left to look up, and
   * undefined until the read made for the library's latest settle answers,
   * so an answer from before a lookup is never counted. Ignored while files
   * are left to look up.
   */
  recommendations: readonly Recommendation[] | undefined;
  /** Opens Account Settings on the Set up TMDB task. */
  setUpTmdb: () => void;
  /** Starts the lookup of every root's outstanding files. */
  lookUpFiles: () => void;
  /** Opens Collections on its Discover dialog. */
  makeCollections: () => void;
}): TrayReminder[] {
  const noKey = tmdbKey?.configured === false;
  const left = filesLeftToLookUp(tmdbKey, mediaRoots);
  const undecided =
    left === 0
      ? (recommendations ?? []).filter(
          (recommendation) => recommendation.decision === null,
        )
      : [];
  const showCount = undecided.filter(
    (recommendation) => recommendation.criterion.kind === "series",
  ).length;
  const notLookedUp = left !== undefined && left > 0;
  const collectionsReady = undecided.length > 0;
  return [
    {
      storageKey: "krazitv.tmdbReminder",
      words: TMDB_REMINDER_WORDS,
      shows: noKey,
      holds: noKey && (mediaRoots?.length ?? 0) > 0,
      act: setUpTmdb,
    },
    {
      storageKey: "krazitv.notLookedUpReminder",
      words: filesNotLookedUpWords(left ?? 0),
      shows: notLookedUp,
      holds: notLookedUp,
      act: lookUpFiles,
    },
    {
      storageKey: "krazitv.collectionsReadyReminder",
      words: collectionsReadyWords(showCount, undecided.length - showCount),
      shows: collectionsReady,
      holds: collectionsReady,
      // Known only from an answered read for a settled library, so the 0
      // reported while files are left or the read is out is never stored.
      count:
        left === 0 && recommendations !== undefined
          ? undecided.length
          : undefined,
      act: makeCollections,
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
