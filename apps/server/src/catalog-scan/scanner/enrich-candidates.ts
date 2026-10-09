import { setMaxListeners } from "node:events";

import { lookUpMovie, type PathHints, type TmdbClient } from "@krazitv/media";

import type {
  CatalogCandidate,
  MetadataMatchRecord,
  ScanStatus,
  ScanSummary,
} from "../contracts.js";

/** One discovered file as enrichment sees it: its candidate and path hints. */
interface HintedCandidate {
  candidate: CatalogCandidate;
  hints: PathHints | undefined;
}

/** Files that share one movie search: the same title and year. */
interface MovieSearch {
  hints: { title: string; year?: number; strength: PathHints["strength"] };
  files: { pathKey: string; hints: PathHints; durationMs: number }[];
}

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
 * without a lookup. With a key, each available movie file not yet settled is
 * looked up, one search per distinct title and year, and the job enters
 * `enriching`; episodes wait for their own lookup. The key is checked once
 * first, so a revoked key costs one call rather than one per title. Returns
 * undefined when cancelled, and rethrows an unexpected error, both only after
 * every started lookup has settled.
 */
export async function enrichCandidates(
  options: EnrichCandidatesOptions,
): Promise<MetadataMatchRecord[] | undefined> {
  const { items, apiKey, settled, status } = options;
  const records = new Map<string, MetadataMatchRecord>();
  const searches = new Map<string, MovieSearch>();
  for (const { candidate, hints } of items) {
    if (hints === undefined || settled.has(candidate.pathKey)) continue;
    if (hints.extra) {
      records.set(candidate.pathKey, {
        kind: "extra",
        pathKey: candidate.pathKey,
        hints,
      });
      continue;
    }
    if (apiKey === undefined || candidate.status !== "available") continue;
    if (hints.series !== undefined || hints.title === undefined) continue;
    const searchKey = `${hints.title.toLowerCase()}\u0000${hints.year ?? ""}`;
    const search = searches.get(searchKey) ?? {
      hints: {
        title: hints.title,
        strength: hints.strength,
        ...(hints.year === undefined ? {} : { year: hints.year }),
      },
      files: [],
    };
    search.files.push({
      pathKey: candidate.pathKey,
      hints,
      durationMs: candidate.durationMs,
    });
    searches.set(searchKey, search);
  }

  if (apiKey !== undefined && searches.size > 0) {
    status.phase = "enriching";
    status.currentPath = null;
    status.lookupCount = [...searches.values()].reduce(
      (count, search) => count + search.files.length,
      0,
    );
    const check = await checkKey(apiKey, options);
    if (check === "cancelled") return undefined;
    const done =
      check === "rejected"
        ? recordRejectedKey([...searches.values()], options, records)
        : await lookUpAll([...searches.values()], apiKey, options, records);
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
  searches: readonly MovieSearch[],
  { now, status }: EnrichCandidatesOptions,
  records: Map<string, MetadataMatchRecord>,
): true {
  const lookedUpAt = now();
  for (const search of searches) {
    const { title, year } = search.hints;
    const query = year === undefined ? { title } : { title, year };
    for (const file of search.files) {
      records.set(file.pathKey, {
        kind: "looked_up",
        lookedUpAt,
        lookup: { kind: "failed", query, reason: "TMDB rejected the key" },
        ...file,
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
  searches: readonly MovieSearch[],
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
    searches.map(async (search) => {
      try {
        const lookup = await lookUpMovie(
          tmdb,
          apiKey,
          search.hints,
          stop.signal,
        );
        const lookedUpAt = now();
        for (const file of search.files) {
          records.set(file.pathKey, {
            kind: "looked_up",
            lookedUpAt,
            lookup,
            ...file,
          });
        }
        status.lookedUpCount += search.files.length;
        status.currentTitle = search.hints.title;
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
