import type { TmdbClient, TmdbTitleQuery } from "../tmdb/tmdb-client.js";
import type { TmdbEpisode, TmdbSeries } from "../tmdb/tmdb-series.js";
import type { TmdbTitleSummary } from "../tmdb/tmdb-title.js";
import {
  holdsEpisodes,
  holdsSeasons,
  placeEpisodes,
  type EpisodeHints,
} from "./episode-placement.js";
import {
  agreeingResults,
  matchTitle,
  sameTitledResults,
  titleQuery,
  type TitleHints,
} from "./match-title.js";

/**
 * How one episode file's lookup ended, with the series query as match
 * evidence. A match places the file in its series: `episodes` holds every
 * TMDB episode of a multi-episode file, or nothing when TMDB lists no such
 * episode, in which case the numbers are the file's own and `season` is
 * null for a number counted past the series' last episode.
 */
export type EpisodeLookup = { query: TmdbTitleQuery } & (
  | {
      kind: "matched";
      series: TmdbSeries;
      season: number | null;
      episode: { first: number; last: number };
      episodes: TmdbEpisode[];
    }
  | { kind: "ambiguous"; candidates: TmdbTitleSummary[] }
  | { kind: "unmatched" }
  | { kind: "failed"; reason: string }
);

/** How a series folder's series resolved before any episode is read. */
type SeriesResolution =
  | { kind: "series"; series: TmdbSeries; query: TmdbTitleQuery }
  | Exclude<EpisodeLookup, { kind: "matched" }>;

/** A search result with its details read, so the folder can be checked against it. */
interface ReadCandidate {
  summary: TmdbTitleSummary;
  series: TmdbSeries;
}

// How many same-titled results a folder is checked against; TMDB's page
// holds twenty, but a title with more than this many namesakes is for the
// owner to settle rather than cost that many reads per folder.
const MAX_CANDIDATES_READ = 10;

/**
 * Looks up the episodes under one series folder, returning one lookup per
 * file in `episodes` order. The folder's series is settled once by the
 * spec's episode rule, then read as `lookUpEpisodesInSeries` reads it. The
 * caller's abort is rethrown once every started request has settled.
 */
export async function lookUpEpisodes(
  client: TmdbClient,
  apiKey: string,
  hints: TitleHints,
  episodes: readonly EpisodeHints[],
  signal?: AbortSignal,
): Promise<EpisodeLookup[]> {
  const resolution = await resolveSeries(
    client,
    apiKey,
    hints,
    episodes,
    signal,
  );
  if (resolution.kind !== "series") return episodes.map(() => resolution);
  return readEpisodes(
    client,
    apiKey,
    resolution.series,
    resolution.query,
    episodes,
    signal,
  );
}

/** How a by-ID read places the files it is given in the series. */
interface SeriesReadOptions {
  /**
   * True when `episodes` are a whole series folder, whose season folders may
   * count through the series; false for places already decided, as a
   * refresh re-reads them, so one file is never re-placed by a rule meant
   * for a folder.
   */
  countThroughSeries: boolean;
}

/**
 * Reads episodes of a series already identified, by the episode rule or by
 * the owner's choice, returning one lookup per file in `episodes` order.
 * `query` stays as the evidence that led to the series.
 */
export async function lookUpEpisodesInSeries(
  client: TmdbClient,
  apiKey: string,
  seriesId: number,
  query: TmdbTitleQuery,
  episodes: readonly EpisodeHints[],
  signal?: AbortSignal,
  options: SeriesReadOptions = { countThroughSeries: true },
): Promise<EpisodeLookup[]> {
  const details = await client.seriesDetails(apiKey, seriesId, signal);
  if (details.kind === "failed") {
    return episodes.map(() => ({ query, ...details }));
  }
  return readEpisodes(
    client,
    apiKey,
    details.value,
    query,
    episodes,
    signal,
    options,
  );
}

/**
 * Reads each file's episodes from a series whose details are known. Each
 * season a file is placed in is fetched once; a file whose episodes the
 * season lists matches them, and one it does not list is still matched to
 * the series with its own numbers, since the series is settled and TMDB's
 * numbering is the only disagreement. A season the series does not list is
 * never fetched.
 */
async function readEpisodes(
  client: TmdbClient,
  apiKey: string,
  series: TmdbSeries,
  query: TmdbTitleQuery,
  episodes: readonly EpisodeHints[],
  signal: AbortSignal | undefined,
  options: SeriesReadOptions = { countThroughSeries: true },
): Promise<EpisodeLookup[]> {
  const places = placeEpisodes(
    series.seasons,
    episodes,
    options.countThroughSeries,
  );
  const seasonNumbers = [
    ...new Set(places.flatMap((place) => place?.season ?? [])),
  ];
  const fetched = await settleAll(
    seasonNumbers.map((season) =>
      client.seasonDetails(apiKey, series.id, season, signal),
    ),
  );
  const seasons = new Map(
    seasonNumbers.map((season, index) => [season, fetched[index]]),
  );

  return episodes.map((hint, index) => {
    const place = places[index];
    const unlisted: EpisodeLookup = {
      query,
      kind: "matched",
      series,
      season: hint.season ?? place?.season ?? null,
      episode: hint.episode,
      episodes: [],
    };
    if (place === undefined) return unlisted;
    const fetchedSeason = seasons.get(place.season);
    if (fetchedSeason?.kind === "failed") return { query, ...fetchedSeason };
    const found: TmdbEpisode[] = [];
    for (let n = place.episode.first; n <= place.episode.last; n += 1) {
      const known = fetchedSeason?.value.episodes.find(
        (candidate) => candidate.number === n,
      );
      if (known === undefined) return unlisted;
      found.push(known);
    }
    return {
      query,
      kind: "matched",
      series,
      season: place.season,
      episode: place.episode,
      episodes: found,
    };
  });
}

/**
 * Settles which series a folder's episodes belong to. Only strong hints can
 * match. The title rule narrows the search to same-titled results agreeing
 * with any year; among those, the folder's own seasons decide: the one
 * series listing every hinted season, or every hinted episode when several
 * do. When nothing agreeing holds the folder, a year-hinted search is run
 * again without the year, since TMDB may date the series differently, and
 * the same-titled series holding the folder is taken. Failing that, a lone
 * agreeing result is still the series, with its episodes read as unlisted.
 * A lone result of the hinted year with another title is the series only
 * when it holds the folder; any other differently titled result is only
 * ever offered to the owner, and weak hints offer every result.
 */
async function resolveSeries(
  client: TmdbClient,
  apiKey: string,
  hints: TitleHints,
  episodes: readonly EpisodeHints[],
  signal: AbortSignal | undefined,
): Promise<SeriesResolution> {
  const query = titleQuery(hints);
  const search = await client.searchSeries(apiKey, query, signal);
  if (search.kind === "failed") return { query, ...search };
  const match = matchTitle(hints, search.value);
  const offered =
    match.kind === "matched"
      ? [match.result]
      : match.kind === "ambiguous"
        ? match.candidates
        : [];
  if (hints.strength === "weak") {
    return match.kind === "unmatched"
      ? { query, kind: "unmatched" }
      : { query, kind: "ambiguous", candidates: offered };
  }
  // A lone dated result with another title, as `Marvel Anime: X-Men` for
  // `Marvel's ANIME - X-Men (2011)`, is checked too, but must hold the folder.
  const agreeing = agreeingResults(hints, search.value);
  const loneDated = match.kind === "matched" ? [match.result] : [];
  const decided = await decideByFolder(
    client,
    apiKey,
    agreeing.length > 0 ? agreeing : loneDated,
    episodes,
    signal,
  );
  if (decided.kind === "failed") return { query, ...decided };
  if (decided.kind === "series") return { ...decided, query };

  if (hints.year !== undefined) {
    const undated = { title: hints.title };
    const again = await client.searchSeries(apiKey, undated, signal);
    if (again.kind === "failed") return { query, ...again };
    const decidedAgain = await decideByFolder(
      client,
      apiKey,
      sameTitledResults(hints, again.value),
      episodes,
      signal,
    );
    if (decidedAgain.kind === "failed") return { query, ...decidedAgain };
    if (decidedAgain.kind === "series") {
      return { ...decidedAgain, query: undated };
    }
  }

  const [only] = decided.read;
  if (agreeing.length === 1 && only !== undefined) {
    return { kind: "series", series: only.series, query };
  }
  if (match.kind === "unmatched") return { query, kind: "unmatched" };
  return {
    query,
    kind: "ambiguous",
    candidates: decided.candidates.length > 0 ? decided.candidates : offered,
  };
}

/**
 * Reads each candidate's details and picks the one whose season list holds
 * the folder's episodes: first by seasons, then by episode counts when
 * several list the same seasons. Otherwise returns the candidates still in
 * the running, in TMDB's order, for the owner, with the details read. More
 * than ten namesakes are left to the owner unread, so no holder goes
 * unchecked; one unreadable candidate fails the lookup, which a retry
 * repeats, rather than deciding on partial evidence.
 */
async function decideByFolder(
  client: TmdbClient,
  apiKey: string,
  summaries: readonly TmdbTitleSummary[],
  episodes: readonly EpisodeHints[],
  signal: AbortSignal | undefined,
): Promise<
  | { kind: "series"; series: TmdbSeries }
  | { kind: "undecided"; candidates: TmdbTitleSummary[]; read: ReadCandidate[] }
  | { kind: "failed"; reason: string }
> {
  if (summaries.length > MAX_CANDIDATES_READ) {
    return { kind: "undecided", candidates: [...summaries], read: [] };
  }
  const details = await settleAll(
    summaries.map((summary) =>
      client.seriesDetails(apiKey, summary.id, signal),
    ),
  );
  const read: ReadCandidate[] = [];
  for (const [index, summary] of summaries.entries()) {
    const detail = details[index];
    if (detail === undefined || detail.kind === "failed") {
      return detail ?? { kind: "failed", reason: "TMDB gave no answer" };
    }
    read.push({ summary, series: detail.value });
  }
  const bySeasons = read.filter(({ series }) =>
    holdsSeasons(series.seasons, episodes),
  );
  const byEpisodes = bySeasons.filter(({ series }) =>
    holdsEpisodes(series.seasons, episodes),
  );
  for (const holding of [bySeasons, byEpisodes]) {
    const [only] = holding;
    if (only !== undefined && holding.length === 1) {
      return { kind: "series", series: only.series };
    }
  }
  const remaining = byEpisodes.length > 0 ? byEpisodes : bySeasons;
  return {
    kind: "undecided",
    candidates: remaining.map(({ summary }) => summary),
    read,
  };
}

/**
 * Awaits every request before rethrowing the first rejection, such as the
 * caller's abort, so no request outlives the lookup that started it.
 */
async function settleAll<T>(promises: readonly Promise<T>[]): Promise<T[]> {
  const settled = await Promise.allSettled(promises);
  return settled.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
}
