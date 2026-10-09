import { setMaxListeners } from "node:events";

import {
  lookUpEpisodes,
  lookUpMovie,
  type EpisodeLookup,
  type MovieLookup,
  type TmdbClient,
} from "@krazitv/media";

import type {
  HintedCandidate,
  LookupGroup,
  MetadataMatchRecord,
  ScanStatus,
  ScanSummary,
} from "../contracts.js";
import { groupLookups } from "./group-lookups.js";

interface EnrichCandidatesOptions {
  /** Every candidate in discovery order, which the records keep. */
  items: readonly HintedCandidate[];
  /** The owner's TMDB key; without one nothing is looked up. */
  apiKey: string | undefined;
  /** Path keys whose decision a scan must leave alone. */
  settled: ReadonlySet<string>;
  tmdb: TmdbClient;
  /** The job's signal; cancelling stops lookups not yet sent. */
  signal: AbortSignal;
  now: () => number;
  /** The job's live status, which this stage's progress updates. */
  status: ScanStatus;
}

/**
 * Builds the scan's metadata match records. An unsettled extra is recorded
 * without a lookup. With a key, each available file not yet settled is looked
 * up, one search per movie title and year or per series folder, and the job
 * enters `enriching`. The key is checked once first, so a revoked key costs
 * one call rather than one per search. Returns undefined when cancelled, and
 * rethrows an unexpected error, both only after every started lookup has
 * settled.
 */
export async function enrichCandidates(
  options: EnrichCandidatesOptions,
): Promise<MetadataMatchRecord[] | undefined> {
  const { items, apiKey, settled, status } = options;
  const records = new Map<string, MetadataMatchRecord>();
  const { extras, groups } = groupLookups(items, settled, apiKey !== undefined);
  for (const extra of extras) records.set(extra.pathKey, extra);

  if (apiKey !== undefined && groups.length > 0) {
    status.phase = "enriching";
    status.currentPath = null;
    status.lookupCount = groups.reduce(
      (count, group) => count + group.files.length,
      0,
    );
    const check = await checkKey(apiKey, options);
    if (check === "cancelled") return undefined;
    const done =
      check === "rejected"
        ? recordRejectedKey(groups, options, records)
        : await lookUpAll(groups, apiKey, options, records);
    if (!done) return undefined;
  }
  return items.flatMap(({ candidate }) => records.get(candidate.pathKey) ?? []);
}

/** Counts this scan's lookups by outcome for its summary. */
export function countLookups(
  records: readonly MetadataMatchRecord[],
): Pick<
  ScanSummary,
  "matchedCount" | "ambiguousCount" | "unmatchedCount" | "lookupErrorCount"
> {
  const counts = {
    matchedCount: 0,
    ambiguousCount: 0,
    unmatchedCount: 0,
    lookupErrorCount: 0,
  };
  for (const record of records) {
    if (record.kind === "extra") continue;
    if (record.lookup.kind === "matched") counts.matchedCount += 1;
    else if (record.lookup.kind === "ambiguous") counts.ambiguousCount += 1;
    else if (record.lookup.kind === "unmatched") counts.unmatchedCount += 1;
    else counts.lookupErrorCount += 1;
  }
  return counts;
}

/**
 * Asks TMDB once whether the saved key still works. An outage is not a
 * rejection, so lookups still run and report their own errors.
 */
async function checkKey(
  apiKey: string,
  { tmdb, signal }: EnrichCandidatesOptions,
): Promise<"usable" | "rejected" | "cancelled"> {
  try {
    const check = await tmdb.checkKey(apiKey, signal);
    return check.kind === "rejected" ? "rejected" : "usable";
  } catch (error) {
    if (signal.aborted) return "cancelled";
    throw error;
  }
}

// Records every search's files as failed lookups without calling TMDB again.
function recordRejectedKey(
  groups: readonly LookupGroup[],
  { now, status }: EnrichCandidatesOptions,
  records: Map<string, MetadataMatchRecord>,
): true {
  const lookedUpAt = now();
  for (const group of groups) {
    const { title, year } = group.hints;
    const query = year === undefined ? { title } : { title, year };
    for (const { pathKey, hints, durationMs } of group.files) {
      records.set(pathKey, {
        kind: "looked_up",
        pathKey,
        hints,
        durationMs,
        lookedUpAt,
        lookup: { kind: "failed", query, reason: "TMDB rejected the key" },
      });
    }
  }
  status.lookedUpCount = status.lookupCount;
  return true;
}

/**
 * Runs every search through the client's shared queue, recording each
 * file's outcome as its search settles. Returns false when cancelled.
 */
async function lookUpAll(
  groups: readonly LookupGroup[],
  apiKey: string,
  { tmdb, signal, now, status }: EnrichCandidatesOptions,
  records: Map<string, MetadataMatchRecord>,
): Promise<boolean> {
  const stop = new AbortController();
  // Every queued lookup listens on this one signal by design, so Node's
  // default 10-listener leak warning would fire on any real library.
  setMaxListeners(0, stop.signal);
  const onAbort = () => stop.abort(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) stop.abort(signal.reason);

  let fatal: { error: unknown } | undefined;
  await Promise.all(
    groups.map(async (group) => {
      try {
        const lookups = await lookUpGroup(tmdb, apiKey, group, stop.signal);
        const lookedUpAt = now();
        group.files.forEach(({ pathKey, hints, durationMs }, index) => {
          const lookup = lookups[index];
          if (lookup === undefined) return;
          records.set(pathKey, {
            kind: "looked_up",
            pathKey,
            hints,
            durationMs,
            lookedUpAt,
            lookup,
          });
        });
        status.lookedUpCount += group.files.length;
        status.currentTitle = group.hints.title;
      } catch (error) {
        if (!stop.signal.aborted) {
          fatal = { error };
          stop.abort();
        }
      }
    }),
  );
  signal.removeEventListener("abort", onAbort);

  if (fatal !== undefined) throw fatal.error;
  return !signal.aborted;
}

/**
 * Runs one group's search, returning one lookup per file in the group's
 * order: a movie's files share its one lookup, while each episode file gets
 * its own against the folder's shared series.
 */
async function lookUpGroup(
  tmdb: TmdbClient,
  apiKey: string,
  group: LookupGroup,
  signal: AbortSignal,
): Promise<(MovieLookup | EpisodeLookup)[]> {
  if (group.kind === "series") {
    return lookUpEpisodes(
      tmdb,
      apiKey,
      group.hints,
      group.files.map((file) => file.episode),
      signal,
    );
  }
  const lookup = await lookUpMovie(tmdb, apiKey, group.hints, signal);
  return group.files.map(() => lookup);
}
